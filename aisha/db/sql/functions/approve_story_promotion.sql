-- Function: public.approve_story_promotion
-- Arguments: p_operation_id uuid
-- Description: Approves a pending promote operation and materializes its payload
--              into the origin story. v1 materializes knowledge_items: matched by
--              (story_id, slug → source_slug); existing items are updated only
--              when the incoming version is higher, new items are inserted
--              (locale from item metadata, default 'global'; source_type
--              'story_promotion'). Embeddings are
--              rebuilt by trg_knowledge_embedding_auto — never synced.
--              Marks the operation success + committed_at and records approver
--              and materialization counts in operation metadata.
-- Security: SECURITY DEFINER — admin/staff only (auth.uid() required)

CREATE OR REPLACE FUNCTION public.approve_story_promotion(p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_operation record;
  v_items jsonb;
  v_item jsonb;
  v_slug text;
  v_title text;
  v_content text;
  v_summary text;
  v_ai_instructions text;
  v_locale text;
  v_version integer;
  v_item_type knowledge_item_type;
  v_tags text[];
  v_existing record;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_materialized integer := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required' USING ERRCODE = '22023';
  END IF;

  SELECT sso.id, sso.story_id, sso.operation_type, sso.outcome,
         sso.source_instance_id, sso.target_instance_id, sso.metadata
  INTO v_operation
  FROM story_sync_operations sso
  WHERE sso.id = p_operation_id
  FOR UPDATE;

  IF v_operation.id IS NULL THEN
    RAISE EXCEPTION 'Sync operation not found: %', p_operation_id USING ERRCODE = '22023';
  END IF;

  IF v_operation.operation_type != 'promote' THEN
    RAISE EXCEPTION 'Operation % is not a promote operation (type: %)',
      p_operation_id, v_operation.operation_type USING ERRCODE = '22023';
  END IF;

  IF v_operation.outcome != 'pending' THEN
    RAISE EXCEPTION 'Operation % is not pending (outcome: %)',
      p_operation_id, v_operation.outcome USING ERRCODE = '22023';
  END IF;

  -- ===== MATERIALIZE KNOWLEDGE ITEMS =====
  v_items := COALESCE(v_operation.metadata->'payload'->'knowledge_items', '[]'::jsonb);

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) AS value
  LOOP
    -- Manifest carries 'slug'/'content'/'tags'/'verified'; tolerate the raw
    -- column names as well (source_slug/body_markdown/ai_context_tags/is_verified).
    -- Export bundles may nest secondary fields under item 'metadata' — read
    -- top-level first, then fall back to metadata.
    v_slug := COALESCE(v_item->>'slug', v_item->>'source_slug');
    v_title := v_item->>'title';
    v_content := COALESCE(v_item->>'content', v_item->>'body_markdown');
    v_summary := COALESCE(v_item->>'summary', v_item->'metadata'->>'summary');
    v_ai_instructions := COALESCE(v_item->>'ai_instructions', v_item->'metadata'->>'ai_instructions');
    v_locale := COALESCE(v_item->'metadata'->>'locale', 'global');
    v_version := COALESCE(NULLIF(v_item->>'version', '')::integer, 1);

    -- NOT NULL columns of knowledge_items: skip items that cannot satisfy them
    IF v_slug IS NULL OR v_title IS NULL OR v_content IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Tags may be absent or JSON null — only unpack a real array
    v_tags := CASE
      WHEN jsonb_typeof(v_item->'tags') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(v_item->'tags'))
      WHEN jsonb_typeof(v_item->'ai_context_tags') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(v_item->'ai_context_tags'))
      ELSE '{}'::text[]
    END;

    SELECT ki.id, ki.version INTO v_existing
    FROM knowledge_items ki
    WHERE ki.story_id = v_operation.story_id
      AND ki.source_slug = v_slug
    ORDER BY ki.version DESC
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      -- Same rule as import: update only when the incoming version is higher
      IF v_version > v_existing.version THEN
        UPDATE knowledge_items SET
          title = v_title,
          summary = v_summary,
          body_markdown = v_content,
          ai_instructions = v_ai_instructions,
          ai_context_tags = v_tags,
          category = COALESCE(v_item->>'category', category),
          version = v_version,
          is_verified = COALESCE(
            (v_item->>'verified')::boolean,
            (v_item->>'is_verified')::boolean,
            is_verified
          ),
          updated_at = now()
        WHERE id = v_existing.id;
        v_updated := v_updated + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    ELSE
      -- idx_knowledge_items_source_slug_locale_unique is GLOBAL on
      -- (source_slug, locale) — a slug already used by another story cannot
      -- be inserted; skip instead of aborting the whole approval
      IF EXISTS (
        SELECT 1 FROM knowledge_items ki
        WHERE ki.source_slug = v_slug AND ki.locale = v_locale
      ) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- item_type is NOT NULL without default; fall back to 'domain_doc' for
      -- unknown/missing values
      BEGIN
        v_item_type := COALESCE(
          NULLIF(v_item->>'item_type', ''),
          NULLIF(v_item->'metadata'->>'item_type', ''),
          'domain_doc'
        )::knowledge_item_type;
      EXCEPTION WHEN invalid_text_representation THEN
        v_item_type := 'domain_doc'::knowledge_item_type;
      END;

      INSERT INTO knowledge_items (
        item_type, source_type, source_slug, locale,
        title, summary, body_markdown, ai_instructions,
        ai_context_tags, category, status, visibility,
        version, is_verified, story_id
      ) VALUES (
        v_item_type, 'story_promotion', v_slug, v_locale,
        v_title, v_summary, v_content, v_ai_instructions,
        v_tags, v_item->>'category',
        COALESCE(v_item->>'status', 'active'),
        COALESCE(v_item->>'visibility', 'public'),
        v_version,
        COALESCE(
          (v_item->>'verified')::boolean,
          (v_item->>'is_verified')::boolean,
          false
        ),
        v_operation.story_id
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  v_materialized := v_inserted + v_updated;

  -- ===== MARK OPERATION APPROVED =====
  UPDATE story_sync_operations SET
    outcome = 'success',
    committed_at = now(),
    metadata = metadata || jsonb_build_object(
      'approved_by', v_user_id,
      'approved_at', now(),
      'materialized', jsonb_build_object(
        'knowledge_items_inserted', v_inserted,
        'knowledge_items_updated', v_updated,
        'knowledge_items_skipped', v_skipped
      )
    )
  WHERE id = p_operation_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_user_id, 'STORY_PROMOTE_APPROVED', jsonb_build_object(
    'area', 'story_sync',
    'severity', 'info',
    'entity_type', 'story_sync_operation',
    'entity_id', p_operation_id,
    'story_id', v_operation.story_id,
    'source_instance_id', v_operation.source_instance_id,
    'target_instance_id', v_operation.target_instance_id,
    'knowledge_items_inserted', v_inserted,
    'knowledge_items_updated', v_updated,
    'knowledge_items_skipped', v_skipped
  ));

  RETURN jsonb_build_object(
    'status', 'success',
    'materialized_knowledge_items', v_materialized,
    'operation_id', p_operation_id,
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'note', 'Embeddings are rebuilt locally by trigger — never synced.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.approve_story_promotion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_story_promotion(uuid) TO authenticated;

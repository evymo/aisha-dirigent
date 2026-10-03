-- Function: public.import_story_bundle
-- Arguments: p_bundle_id uuid, p_instance_token text DEFAULT NULL, p_target_instance_id uuid DEFAULT NULL
-- Description: Imports a story bundle into a target instance. Supports two auth modes:
--              1. Token-based (M2M sync): pass p_instance_token for scoped auth;
--                 auth.uid() MAY be NULL (actor_type 'instance')
--              2. Role-based (UI import): admin/staff without token
--              Validates manifest integrity (SHA-256), respects sync policies,
--              blocks domains where flow direction forbids import, and materializes
--              expert rules, the story ruleset and knowledge items server-side.
--              Ruleset fingerprint is recomputed locally and verified against the
--              manifest (schema_version >= 1.1.0); mismatch yields outcome 'partial'.
--              Embeddings are rebuilt by the existing knowledge-item trigger.
-- Security: SECURITY DEFINER — valid instance token or auth.uid() + admin/staff

-- Drop legacy 2-arg overload (replaced by 3-arg with token auth)
DROP FUNCTION IF EXISTS public.import_story_bundle(uuid, uuid);

CREATE OR REPLACE FUNCTION public.import_story_bundle(
  p_bundle_id uuid,
  p_instance_token text DEFAULT NULL,
  p_target_instance_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id uuid;
  v_bundle record;
  v_manifest jsonb;
  v_target_instance record;
  v_operation_id uuid;
  v_story_id uuid;
  v_imported_policies integer := 0;
  v_policy_item jsonb;
  v_auth_result jsonb;
  v_computed_hash text;
  v_blocked_domains jsonb := '[]'::jsonb;
  v_skipped_domains text[] := '{}';
  v_actor_ref text;
  v_actor_type text;
  v_rules_blocked boolean := false;
  v_knowledge_blocked boolean := false;
  v_rules_materialized boolean := false;
  v_rule_item jsonb;
  v_ki_item jsonb;
  v_slug text;
  v_local_rule record;
  v_local_ki record;
  v_category expert_rule_category;
  v_item_type knowledge_item_type;
  v_tags text[];
  v_locale text;
  v_incoming_version integer;
  v_author_partner_id uuid;
  v_materialized_rules integer := 0;
  v_updated_rules integer := 0;
  v_skipped_rules integer := 0;
  v_skipped_shared_rules integer := 0;
  v_shared_rule_slugs text[] := '{}';
  v_txt text;
  v_verified boolean;
  v_materialized_knowledge_items integer := 0;
  v_updated_knowledge_items integer := 0;
  v_skipped_knowledge_items integer := 0;
  v_local_rule_ids uuid[] := '{}';
  v_rule_versions jsonb := '{}'::jsonb;
  v_ruleset_id uuid;
  v_local_fingerprint text;
  v_manifest_fingerprint text;
  v_fingerprint_verified boolean;
  v_manifest_schema text;
  v_manifest_is_v11 boolean := false;
  v_outcome sync_operation_outcome := 'success';
  v_note text;
BEGIN
  -- auth.uid() may be NULL for M2M sync — a valid instance token is required then
  v_user_id := auth.uid();

  -- Load bundle first to get story_id
  SELECT id, story_id, bundle_version, portable_manifest, schema_version,
         exported_from_instance_id, ruleset_fingerprint, bundle_manifest_hash
  INTO v_bundle
  FROM story_bundles
  WHERE id = p_bundle_id;

  IF v_bundle.id IS NULL THEN
    RAISE EXCEPTION 'Bundle not found: %', p_bundle_id USING ERRCODE = '22023';
  END IF;

  v_story_id := v_bundle.story_id;
  v_manifest := v_bundle.portable_manifest;

  -- Load target instance
  SELECT id, story_id, is_origin, last_bundle_version, schema_version
  INTO v_target_instance
  FROM story_instances
  WHERE id = p_target_instance_id;

  IF v_target_instance.id IS NULL THEN
    RAISE EXCEPTION 'Target instance not found: %', p_target_instance_id USING ERRCODE = '22023';
  END IF;

  IF v_target_instance.story_id != v_story_id THEN
    RAISE EXCEPTION 'Instance % does not belong to story %', p_target_instance_id, v_story_id USING ERRCODE = '22023';
  END IF;

  -- ===== AUTHORIZATION =====
  -- If token provided: validate via instance auth (M2M sync, auth.uid() may be NULL)
  -- If no token: require auth.uid() + admin/staff (manual import from UI)
  IF p_instance_token IS NOT NULL THEN
    v_auth_result := public.validate_sync_authorization(
      p_target_instance_id, p_instance_token, 'import', v_story_id
    );

    IF NOT (v_auth_result->>'authorized')::boolean THEN
      -- Record failed attempt in audit (user_id nullable — FK-safe)
      INSERT INTO audit_journal (user_id, action, metadata)
      VALUES (v_user_id, 'SYNC_IMPORT_DENIED', jsonb_build_object(
        'area', 'story_sync', 'severity', 'warning',
        'story_id', v_story_id,
        'target_instance_id', p_target_instance_id,
        'bundle_id', p_bundle_id,
        'reason', v_auth_result->>'reason'
      ));

      RETURN jsonb_build_object(
        'status', 'denied',
        'reason', v_auth_result->>'reason'
      );
    END IF;

    -- Collect blocked domains from auth result
    v_blocked_domains := COALESCE(v_auth_result->'blocked_domains', '[]'::jsonb);
  ELSE
    -- No token: authenticated admin/staff required
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
    END IF;

    IF NOT public.is_admin_or_staff() THEN
      RAISE EXCEPTION 'Unauthorized: provide instance token or use admin/staff account' USING ERRCODE = '22023';
    END IF;

    -- Admin/staff can still not import into origin
    IF v_target_instance.is_origin THEN
      RAISE EXCEPTION 'Cannot import into origin instance. Use promote operation for upstream changes.' USING ERRCODE = '22023';
    END IF;

    v_blocked_domains := '[]'::jsonb;
  END IF;

  v_actor_ref := COALESCE(v_user_id::text, 'instance:' || p_target_instance_id);
  v_actor_type := CASE WHEN v_user_id IS NULL THEN 'instance' ELSE 'human' END;

  v_rules_blocked := EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_blocked_domains) bd
    WHERE bd->>'data_domain' = 'rulesets' AND (bd->>'blocked')::boolean
  );
  v_knowledge_blocked := EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_blocked_domains) bd
    WHERE bd->>'data_domain' = 'knowledge_items' AND (bd->>'blocked')::boolean
  );

  -- Manifest schema version gate: 1.1.0 bundles carry ai_instructions in
  -- expert_rules, so the locally recomputed fingerprint is comparable.
  v_manifest_schema := COALESCE(v_manifest->>'schema_version', '1.0.0');
  IF v_manifest_schema ~ '^\d+\.\d+\.\d+$' THEN
    v_manifest_is_v11 := string_to_array(v_manifest_schema, '.')::int[] >= ARRAY[1, 1, 0];
  END IF;

  -- ===== INTEGRITY VERIFICATION =====
  IF v_bundle.bundle_manifest_hash IS NOT NULL THEN
    v_computed_hash := encode(digest(v_manifest::text, 'sha256'), 'hex');

    IF v_computed_hash != v_bundle.bundle_manifest_hash THEN
      INSERT INTO audit_journal (user_id, action, metadata)
      VALUES (v_user_id, 'SYNC_INTEGRITY_VIOLATION', jsonb_build_object(
        'area', 'story_sync', 'severity', 'critical',
        'story_id', v_story_id,
        'bundle_id', p_bundle_id,
        'expected_hash', v_bundle.bundle_manifest_hash,
        'computed_hash', v_computed_hash
      ));

      RETURN jsonb_build_object(
        'status', 'integrity_error',
        'reason', 'Bundle manifest hash mismatch — possible tampering detected'
      );
    END IF;
  END IF;

  -- Idempotency: skip if already at this version or newer
  IF v_target_instance.last_bundle_version >= v_bundle.bundle_version THEN
    RETURN jsonb_build_object(
      'status', 'skipped',
      'reason', 'Instance already at bundle version ' || v_target_instance.last_bundle_version,
      'bundle_version', v_bundle.bundle_version
    );
  END IF;

  -- Create pending sync operation
  INSERT INTO story_sync_operations (
    story_id, bundle_id, bundle_version, operation_type,
    source_instance_id, target_instance_id, ruleset_fingerprint,
    actor_ref, actor_type, outcome
  ) VALUES (
    v_story_id, p_bundle_id, v_bundle.bundle_version, 'import',
    v_bundle.exported_from_instance_id, p_target_instance_id,
    v_bundle.ruleset_fingerprint,
    v_actor_ref, v_actor_type, 'pending'
  ) RETURNING id INTO v_operation_id;

  -- Update story_contexts: portable config (merge, don't overwrite local_overlay)
  UPDATE story_contexts SET
    portable_config = COALESCE(v_manifest->'portable_config', '{}'::jsonb),
    build_config = COALESCE(v_manifest->'build_config', build_config),
    active_instance_id = p_target_instance_id,
    active_bundle_version = v_bundle.bundle_version,
    updated_at = now()
  WHERE story_id = v_story_id;

  -- Upsert sync policies from manifest (skip blocked domains)
  IF v_manifest ? 'sync_policies' AND jsonb_typeof(v_manifest->'sync_policies') = 'array' THEN
    FOR v_policy_item IN SELECT value FROM jsonb_array_elements(v_manifest->'sync_policies') AS value
    LOOP
      -- Check if domain is blocked by flow direction
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_blocked_domains) bd
        WHERE (bd->>'data_domain') = (v_policy_item->>'data_domain')
          AND (bd->>'blocked')::boolean = true
      ) THEN
        v_skipped_domains := v_skipped_domains || (v_policy_item->>'data_domain');
        CONTINUE;
      END IF;

      INSERT INTO story_sync_policies (story_id, data_domain, data_class, flow_direction, description)
      VALUES (
        v_story_id,
        v_policy_item->>'data_domain',
        (v_policy_item->>'data_class')::sync_data_class,
        (v_policy_item->>'flow_direction')::sync_flow_direction,
        v_policy_item->>'description'
      )
      ON CONFLICT (story_id, data_domain) DO UPDATE SET
        data_class = EXCLUDED.data_class,
        flow_direction = EXCLUDED.flow_direction,
        description = EXCLUDED.description,
        updated_at = now();
      v_imported_policies := v_imported_policies + 1;
    END LOOP;
  END IF;

  -- ===== MATERIALIZATION: EXPERT RULES (domain 'rulesets') =====
  -- Manifest keys map to columns: content→body_markdown, tags→ai_context_tags.
  -- slug is matched by SELECT (no reliance on a unique constraint).
  IF v_rules_blocked THEN
    IF NOT ('rulesets' = ANY(v_skipped_domains)) THEN
      v_skipped_domains := v_skipped_domains || 'rulesets'::text;
    END IF;
  ELSIF jsonb_typeof(v_manifest->'expert_rules') = 'array'
    AND jsonb_array_length(v_manifest->'expert_rules') > 0 THEN

    -- expert_rules.author_partner_id is NOT NULL: resolve from the story's
    -- partner, else reuse the earliest local author (replica bootstraps have
    -- no partner context of their own). Without any candidate, inserts are skipped.
    SELECT ps.partner_id INTO v_author_partner_id
    FROM partner_stories ps
    WHERE ps.id = v_story_id;

    IF v_author_partner_id IS NULL THEN
      SELECT er.author_partner_id INTO v_author_partner_id
      FROM expert_rules er
      ORDER BY er.created_at ASC
      LIMIT 1;
    END IF;

    FOR v_rule_item IN SELECT value FROM jsonb_array_elements(v_manifest->'expert_rules') AS value
    LOOP
      v_slug := v_rule_item->>'slug';
      IF v_slug IS NULL OR v_slug = '' THEN
        v_skipped_rules := v_skipped_rules + 1;
        CONTINUE;
      END IF;

      -- Strict cast guard: manifest is untrusted input
      v_txt := v_rule_item->>'version';
      IF v_txt IS NULL THEN
        v_incoming_version := 1;
      ELSIF v_txt ~ '^[0-9]+$' THEN
        v_incoming_version := v_txt::integer;
      ELSE
        RAISE EXCEPTION 'Invalid version "%" for expert rule slug "%": expected a non-negative integer', v_txt, v_slug
          USING ERRCODE = '22023';
      END IF;

      IF EXISTS (
        SELECT 1 FROM unnest(enum_range(NULL::expert_rule_category)) e
        WHERE e::text = v_rule_item->>'category'
      ) THEN
        v_category := (v_rule_item->>'category')::expert_rule_category;
      ELSE
        v_category := 'other';
      END IF;

      SELECT COALESCE(array_agg(t.val), '{}'::text[]) INTO v_tags
      FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(v_rule_item->'tags') = 'array'
             THEN v_rule_item->'tags' ELSE '[]'::jsonb END
      ) AS t(val);

      SELECT er.id, er.version INTO v_local_rule
      FROM expert_rules er
      WHERE er.slug = v_slug
      ORDER BY er.version DESC, er.created_at DESC
      LIMIT 1;

      IF v_local_rule.id IS NULL THEN
        IF v_author_partner_id IS NULL THEN
          -- No resolvable author for a NOT NULL column — skip, reported in metadata
          v_skipped_rules := v_skipped_rules + 1;
          CONTINUE;
        END IF;

        INSERT INTO expert_rules (
          slug, title, category, body_markdown, ai_instructions,
          version, ai_context_tags, status, author_partner_id, published_at
        ) VALUES (
          v_slug,
          COALESCE(v_rule_item->>'title', v_slug),
          v_category,
          COALESCE(v_rule_item->>'content', ''),
          v_rule_item->>'ai_instructions',
          v_incoming_version,
          v_tags,
          'published',
          v_author_partner_id,
          now()
        );
        v_materialized_rules := v_materialized_rules + 1;
      ELSIF v_incoming_version > COALESCE(v_local_rule.version, 0) THEN
        -- Cross-story guard: never mutate a rule referenced by another story's
        -- ruleset — an import must not tamper with shared rules
        IF EXISTS (
          SELECT 1
          FROM story_rulesets r
          JOIN story_contexts sc ON sc.ruleset_id = r.id
          WHERE v_local_rule.id = ANY(r.rule_ids)
            AND sc.story_id <> v_story_id
        ) THEN
          v_skipped_shared_rules := v_skipped_shared_rules + 1;
          v_shared_rule_slugs := v_shared_rule_slugs || v_slug;
          CONTINUE;
        END IF;

        UPDATE expert_rules SET
          title = COALESCE(v_rule_item->>'title', title),
          category = v_category,
          body_markdown = COALESCE(v_rule_item->>'content', body_markdown),
          ai_instructions = v_rule_item->>'ai_instructions',
          version = v_incoming_version,
          ai_context_tags = v_tags,
          status = 'published',
          updated_at = now()
        WHERE id = v_local_rule.id;
        v_updated_rules := v_updated_rules + 1;

        INSERT INTO audit_journal (user_id, action, metadata)
        VALUES (v_user_id, 'SYNC_RULE_OVERWRITTEN', jsonb_build_object(
          'area', 'story_sync', 'severity', 'info',
          'entity_type', 'expert_rule',
          'entity_id', v_local_rule.id,
          'story_id', v_story_id,
          'bundle_id', p_bundle_id,
          'slug', v_slug,
          'old_version', v_local_rule.version,
          'new_version', v_incoming_version
        ));
      END IF;
      -- else: local version is same or newer — skip silently (no downgrade)
    END LOOP;

    -- One aggregated audit record for all shared-rule skips
    IF v_skipped_shared_rules > 0 THEN
      INSERT INTO audit_journal (user_id, action, metadata)
      VALUES (v_user_id, 'SYNC_RULE_SHARED_SKIPPED', jsonb_build_object(
        'area', 'story_sync', 'severity', 'warning',
        'entity_type', 'expert_rule',
        'story_id', v_story_id,
        'bundle_id', p_bundle_id,
        'slugs', to_jsonb(v_shared_rule_slugs)
      ));
    END IF;

    -- Resolve local rule ids for the manifest slugs (deterministic: ORDER BY slug;
    -- duplicate slugs collapse to the highest local version)
    SELECT COALESCE(array_agg(s.id ORDER BY s.slug), '{}'::uuid[]),
           COALESCE(jsonb_object_agg(s.slug, s.version), '{}'::jsonb)
    INTO v_local_rule_ids, v_rule_versions
    FROM (
      SELECT DISTINCT ON (er.slug) er.id, er.slug, er.version
      FROM expert_rules er
      WHERE er.slug IN (
        SELECT DISTINCT r.value->>'slug'
        FROM jsonb_array_elements(v_manifest->'expert_rules') AS r(value)
        WHERE r.value->>'slug' IS NOT NULL
      )
      ORDER BY er.slug, er.version DESC, er.created_at DESC
    ) s;

    -- Recompute ruleset fingerprint locally (same formula as
    -- fn_recalculate_ruleset_fingerprint: published rules only)
    SELECT md5(string_agg(
      er.slug || ':' || er.version::text || ':' || COALESCE(er.ai_instructions, ''),
      '|' ORDER BY er.slug
    ))
    INTO v_local_fingerprint
    FROM expert_rules er
    WHERE er.id = ANY(v_local_rule_ids)
      AND er.status = 'published';

    v_local_fingerprint := COALESCE(v_local_fingerprint, 'empty');

    -- Materialize the story ruleset and bind it to the story context
    SELECT sc.ruleset_id INTO v_ruleset_id
    FROM story_contexts sc
    WHERE sc.story_id = v_story_id;

    IF v_ruleset_id IS NOT NULL THEN
      UPDATE story_rulesets SET
        rule_ids = v_local_rule_ids,
        rule_versions = v_rule_versions,
        context_profile = COALESCE(v_manifest->'ruleset'->>'context_profile', context_profile),
        ruleset_fingerprint = v_local_fingerprint
      WHERE id = v_ruleset_id;
    ELSE
      INSERT INTO story_rulesets (
        story_id, ruleset_fingerprint, rule_ids, rule_versions, context_profile, created_by
      ) VALUES (
        v_story_id, v_local_fingerprint, v_local_rule_ids, v_rule_versions,
        COALESCE(v_manifest->'ruleset'->>'context_profile', 'repo_plus_rules'),
        v_actor_ref
      ) RETURNING id INTO v_ruleset_id;

      -- story_contexts has PRIMARY KEY (story_id) — ON CONFLICT is safe
      INSERT INTO story_contexts (story_id, ruleset_id, active_instance_id, active_bundle_version)
      VALUES (v_story_id, v_ruleset_id, p_target_instance_id, v_bundle.bundle_version)
      ON CONFLICT (story_id) DO UPDATE SET
        ruleset_id = EXCLUDED.ruleset_id,
        updated_at = now();
    END IF;

    v_rules_materialized := true;
  END IF;

  -- ===== FINGERPRINT VERIFICATION =====
  -- Only meaningful when rules were materialized and the manifest carries
  -- ai_instructions (schema >= 1.1.0). 1.0.0 bundles: fingerprint_verified stays NULL.
  IF v_rules_materialized AND v_manifest_is_v11 THEN
    v_manifest_fingerprint := v_manifest->'ruleset'->>'fingerprint';
    v_fingerprint_verified := (v_manifest_fingerprint IS NOT NULL
                               AND v_local_fingerprint = v_manifest_fingerprint);

    IF NOT v_fingerprint_verified THEN
      v_outcome := 'partial';
      INSERT INTO audit_journal (user_id, action, metadata)
      VALUES (v_user_id, 'SYNC_FINGERPRINT_MISMATCH', jsonb_build_object(
        'area', 'story_sync', 'severity', 'warning',
        'story_id', v_story_id,
        'bundle_id', p_bundle_id,
        'operation_id', v_operation_id,
        'manifest_fingerprint', v_manifest_fingerprint,
        'local_fingerprint', v_local_fingerprint
      ));
    END IF;
  END IF;

  -- ===== MATERIALIZATION: KNOWLEDGE ITEMS (domain 'knowledge_items') =====
  -- Matched by (story_id, slug→source_slug). Embeddings are rebuilt by the
  -- existing knowledge-item trigger — not touched here.
  IF v_knowledge_blocked THEN
    IF NOT ('knowledge_items' = ANY(v_skipped_domains)) THEN
      v_skipped_domains := v_skipped_domains || 'knowledge_items'::text;
    END IF;
  ELSIF jsonb_typeof(v_manifest->'knowledge_items') = 'array' THEN
    FOR v_ki_item IN SELECT value FROM jsonb_array_elements(v_manifest->'knowledge_items') AS value
    LOOP
      v_slug := v_ki_item->>'slug';
      IF v_slug IS NULL OR v_slug = '' THEN
        -- Items without a slug cannot be idempotently matched — skip
        v_skipped_knowledge_items := v_skipped_knowledge_items + 1;
        CONTINUE;
      END IF;

      -- Strict cast guards: manifest is untrusted input
      v_txt := v_ki_item->>'version';
      IF v_txt IS NULL THEN
        v_incoming_version := 1;
      ELSIF v_txt ~ '^[0-9]+$' THEN
        v_incoming_version := v_txt::integer;
      ELSE
        RAISE EXCEPTION 'Invalid version "%" for knowledge item slug "%": expected a non-negative integer', v_txt, v_slug
          USING ERRCODE = '22023';
      END IF;

      v_txt := v_ki_item->>'verified';
      IF v_txt IS NULL THEN
        v_verified := NULL;  -- COALESCE defaults apply below
      ELSIF lower(v_txt) IN ('true', 'false', 't', 'f') THEN
        v_verified := lower(v_txt) IN ('true', 't');
      ELSE
        RAISE EXCEPTION 'Invalid verified flag "%" for knowledge item slug "%": expected true/false/t/f', v_txt, v_slug
          USING ERRCODE = '22023';
      END IF;

      v_locale := COALESCE(v_ki_item->'metadata'->>'locale', 'global');

      SELECT COALESCE(array_agg(t.val), '{}'::text[]) INTO v_tags
      FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(v_ki_item->'tags') = 'array'
             THEN v_ki_item->'tags' ELSE '[]'::jsonb END
      ) AS t(val);

      SELECT ki.id, ki.version INTO v_local_ki
      FROM knowledge_items ki
      WHERE ki.story_id = v_story_id
        AND ki.source_slug = v_slug
      ORDER BY ki.version DESC, ki.created_at DESC
      LIMIT 1;

      IF v_local_ki.id IS NULL THEN
        -- Unique index (source_slug, locale) is global — a slug owned by another
        -- story/context must not be hijacked; skip instead of failing the import
        IF EXISTS (
          SELECT 1 FROM knowledge_items k2
          WHERE k2.source_slug = v_slug AND k2.locale = v_locale
        ) THEN
          v_skipped_knowledge_items := v_skipped_knowledge_items + 1;
          CONTINUE;
        END IF;

        IF EXISTS (
          SELECT 1 FROM unnest(enum_range(NULL::knowledge_item_type)) e
          WHERE e::text = v_ki_item->'metadata'->>'item_type'
        ) THEN
          v_item_type := (v_ki_item->'metadata'->>'item_type')::knowledge_item_type;
        ELSE
          v_item_type := 'domain_doc';
        END IF;

        INSERT INTO knowledge_items (
          item_type, source_type, source_slug, title, summary, body_markdown,
          ai_instructions, ai_context_tags, category, status, version,
          is_verified, story_id, locale
        ) VALUES (
          v_item_type,
          COALESCE(v_ki_item->'metadata'->>'source_type', 'story_sync'),
          v_slug,
          COALESCE(v_ki_item->>'title', v_slug),
          v_ki_item->'metadata'->>'summary',
          COALESCE(v_ki_item->>'content', ''),
          v_ki_item->'metadata'->>'ai_instructions',
          v_tags,
          v_ki_item->>'category',
          COALESCE(v_ki_item->>'status', 'active'),
          v_incoming_version,
          COALESCE(v_verified, false),
          v_story_id,
          v_locale
        );
        v_materialized_knowledge_items := v_materialized_knowledge_items + 1;
      ELSIF v_incoming_version > COALESCE(v_local_ki.version, 0) THEN
        UPDATE knowledge_items SET
          title = COALESCE(v_ki_item->>'title', title),
          summary = COALESCE(v_ki_item->'metadata'->>'summary', summary),
          body_markdown = COALESCE(v_ki_item->>'content', body_markdown),
          ai_instructions = COALESCE(v_ki_item->'metadata'->>'ai_instructions', ai_instructions),
          ai_context_tags = v_tags,
          category = COALESCE(v_ki_item->>'category', category),
          status = COALESCE(v_ki_item->>'status', status),
          version = v_incoming_version,
          is_verified = COALESCE(v_verified, is_verified),
          updated_at = now()
        WHERE id = v_local_ki.id;
        v_updated_knowledge_items := v_updated_knowledge_items + 1;
      END IF;
      -- else: local version is same or newer — skip silently (no downgrade)
    END LOOP;
  END IF;

  -- Update instance tracking
  UPDATE story_instances SET
    last_bundle_version = v_bundle.bundle_version,
    last_sync_at = now(),
    schema_version = v_bundle.schema_version,
    updated_at = now()
  WHERE id = p_target_instance_id;

  v_note := 'Rules and knowledge items materialized server-side. Embeddings rebuild via trigger.';
  IF NOT v_manifest_is_v11 THEN
    v_note := v_note || ' Fingerprint verification skipped: manifest schema_version '
      || v_manifest_schema || ' has no ai_instructions in expert_rules.';
  END IF;

  -- Mark operation outcome ('partial' on fingerprint mismatch, never fail)
  UPDATE story_sync_operations SET
    outcome = v_outcome,
    committed_at = now(),
    metadata = jsonb_build_object(
      'imported_policies', v_imported_policies,
      'skipped_domains', to_jsonb(v_skipped_domains),
      'knowledge_items_in_manifest', jsonb_array_length(COALESCE(v_manifest->'knowledge_items', '[]'::jsonb)),
      'rules_in_manifest', jsonb_array_length(COALESCE(v_manifest->'expert_rules', '[]'::jsonb)),
      'integrity_verified', v_bundle.bundle_manifest_hash IS NOT NULL,
      'materialized_rules', v_materialized_rules,
      'updated_rules', v_updated_rules,
      'skipped_rules', v_skipped_rules,
      'skipped_shared_rules', v_skipped_shared_rules,
      'materialized_knowledge_items', v_materialized_knowledge_items,
      'updated_knowledge_items', v_updated_knowledge_items,
      'skipped_knowledge_items', v_skipped_knowledge_items,
      'ruleset_fingerprint_verified', v_fingerprint_verified,
      'local_ruleset_fingerprint', v_local_fingerprint
    )
  WHERE id = v_operation_id;

  -- Audit journal (user_id nullable — M2M import runs without auth.uid())
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_user_id, 'STORY_BUNDLE_IMPORT', jsonb_build_object(
    'area', 'story_sync',
    'severity', 'info',
    'entity_type', 'story_bundle',
    'entity_id', p_bundle_id,
    'story_id', v_story_id,
    'target_instance_id', p_target_instance_id,
    'bundle_version', v_bundle.bundle_version,
    'operation_id', v_operation_id,
    'actor_ref', v_actor_ref,
    'integrity_verified', v_bundle.bundle_manifest_hash IS NOT NULL,
    'skipped_domains', to_jsonb(v_skipped_domains),
    'materialized_rules', v_materialized_rules,
    'updated_rules', v_updated_rules,
    'materialized_knowledge_items', v_materialized_knowledge_items,
    'ruleset_fingerprint_verified', v_fingerprint_verified
  ));

  RETURN jsonb_build_object(
    'status', v_outcome::text,
    'operation_id', v_operation_id,
    'bundle_version', v_bundle.bundle_version,
    'imported_policies', v_imported_policies,
    'skipped_domains', to_jsonb(v_skipped_domains),
    'integrity_verified', v_bundle.bundle_manifest_hash IS NOT NULL,
    'materialized_rules', v_materialized_rules,
    'updated_rules', v_updated_rules,
    'materialized_knowledge_items', v_materialized_knowledge_items,
    'ruleset_fingerprint_verified', v_fingerprint_verified,
    'note', v_note
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.import_story_bundle(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_story_bundle(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_story_bundle(uuid, text, uuid) TO service_role;

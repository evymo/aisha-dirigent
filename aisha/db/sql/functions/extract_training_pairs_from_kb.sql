-- =============================================================================
-- Function: extract_training_pairs_from_kb
-- Purpose: Extract instruction/response training pairs from knowledge base
-- Part of: AISHA Learning Engine (ALE) — Phase 1 (L2 Data Curation)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.extract_training_pairs_from_kb(
  p_dataset_id uuid,
  p_domain_tags text[] DEFAULT '{}'::text[],
  p_limit integer DEFAULT 500,
  p_org_id uuid DEFAULT NULL,
  p_source_types text[] DEFAULT ARRAY['knowledge_items', 'expert_rules']
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_inserted_count integer := 0;
  v_skipped_count integer := 0;
  v_ki_count integer := 0;
  v_er_count integer := 0;
  rec record;
BEGIN
  -- Auth check: admin/staff only
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Permission denied: admin or staff required';
  END IF;

  -- Validate dataset exists
  IF NOT EXISTS (SELECT 1 FROM public.training_datasets WHERE id = p_dataset_id) THEN
    RAISE EXCEPTION 'Dataset not found: %', p_dataset_id;
  END IF;

  -- -------------------------------------------------------------------------
  -- Extract from knowledge_items (body_markdown + ai_instructions → pairs)
  -- -------------------------------------------------------------------------
  IF 'knowledge_items' = ANY(p_source_types) THEN
    FOR rec IN
      SELECT
        ki.id,
        ki.title,
        ki.summary,
        ki.body_markdown,
        ki.ai_instructions,
        ki.ai_context_tags
      FROM public.knowledge_items ki
      WHERE ki.status = 'active'
        AND ki.is_verified = true
        AND (array_length(p_domain_tags, 1) IS NULL OR ki.ai_context_tags && p_domain_tags)
        -- Skip already-extracted items for this dataset
        AND NOT EXISTS (
          SELECT 1 FROM public.training_examples te
          WHERE te.dataset_id = p_dataset_id
            AND te.source_type = 'knowledge_items'
            AND te.source_id = ki.id
        )
      ORDER BY ki.updated_at DESC
      LIMIT p_limit
    LOOP
      -- Pair 1: "Explain {title}" → body_markdown (knowledge instruction)
      IF rec.body_markdown IS NOT NULL AND length(rec.body_markdown) > 50 THEN
        INSERT INTO public.training_examples (
          dataset_id, example_type, instruction, input, output,
          domain_tags, source_id, source_type, metadata
        ) VALUES (
          p_dataset_id,
          'instruction',
          'Explain the following topic according to our knowledge base: ' || rec.title,
          COALESCE(rec.summary, ''),
          rec.body_markdown,
          COALESCE(rec.ai_context_tags, '{}'::text[]),
          rec.id,
          'knowledge_items',
          jsonb_build_object('extraction_type', 'kb_explain', 'title', rec.title)
        );
        v_ki_count := v_ki_count + 1;
      ELSE
        v_skipped_count := v_skipped_count + 1;
      END IF;

      -- Pair 2: If ai_instructions exist → "How should AI handle {title}?" → ai_instructions
      IF rec.ai_instructions IS NOT NULL AND length(rec.ai_instructions) > 20 THEN
        INSERT INTO public.training_examples (
          dataset_id, example_type, instruction, input, output,
          domain_tags, source_id, source_type, metadata
        ) VALUES (
          p_dataset_id,
          'instruction',
          'What are the AI guidelines for: ' || rec.title || '?',
          '',
          rec.ai_instructions,
          COALESCE(rec.ai_context_tags, '{}'::text[]),
          rec.id,
          'knowledge_items',
          jsonb_build_object('extraction_type', 'kb_ai_instructions', 'title', rec.title)
        );
        v_ki_count := v_ki_count + 1;
      END IF;
    END LOOP;
  END IF;

  -- -------------------------------------------------------------------------
  -- Extract from expert_rules (rule → ai_instructions pairs)
  -- -------------------------------------------------------------------------
  IF 'expert_rules' = ANY(p_source_types) THEN
    FOR rec IN
      SELECT
        er.id,
        er.title,
        er.category,
        er.body_markdown,
        er.ai_instructions,
        er.ai_context_tags
      FROM public.expert_rules er
      WHERE er.status = 'published'
        AND (array_length(p_domain_tags, 1) IS NULL OR er.ai_context_tags && p_domain_tags)
        AND NOT EXISTS (
          SELECT 1 FROM public.training_examples te
          WHERE te.dataset_id = p_dataset_id
            AND te.source_type = 'expert_rules'
            AND te.source_id = er.id
        )
      ORDER BY er.updated_at DESC
      LIMIT p_limit
    LOOP
      -- Expert rule → compliance instruction pair
      IF rec.ai_instructions IS NOT NULL AND length(rec.ai_instructions) > 20 THEN
        INSERT INTO public.training_examples (
          dataset_id, example_type, instruction, input, output,
          system_prompt, domain_tags, source_id, source_type, metadata
        ) VALUES (
          p_dataset_id,
          'instruction',
          'What is the expert rule for "' || rec.title || '" in category "' || COALESCE(rec.category, 'general') || '"?',
          COALESCE(rec.body_markdown, ''),
          rec.ai_instructions,
          'You are a compliance-aware AI assistant that follows organizational expert rules strictly.',
          COALESCE(rec.ai_context_tags, '{}'::text[]),
          rec.id,
          'expert_rules',
          jsonb_build_object('extraction_type', 'rule_compliance', 'category', rec.category)
        );
        v_er_count := v_er_count + 1;
      ELSE
        v_skipped_count := v_skipped_count + 1;
      END IF;
    END LOOP;
  END IF;

  v_inserted_count := v_ki_count + v_er_count;

  -- Audit
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'ALE_KB_EXTRACTION',
    jsonb_build_object(
      'dataset_id', p_dataset_id,
      'inserted', v_inserted_count,
      'skipped', v_skipped_count,
      'from_knowledge_items', v_ki_count,
      'from_expert_rules', v_er_count,
      'domain_tags', p_domain_tags
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'inserted_count', v_inserted_count,
    'skipped_count', v_skipped_count,
    'knowledge_items_count', v_ki_count,
    'expert_rules_count', v_er_count
  );
END;
$$;

-- Permissions: admin/staff only
REVOKE ALL ON FUNCTION public.extract_training_pairs_from_kb(uuid, text[], integer, uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.extract_training_pairs_from_kb(uuid, text[], integer, uuid, text[]) TO authenticated;

COMMENT ON FUNCTION public.extract_training_pairs_from_kb(uuid, text[], integer, uuid, text[]) IS
  'Extract instruction/response training pairs from knowledge_items and expert_rules into a training dataset. Admin/staff only.';

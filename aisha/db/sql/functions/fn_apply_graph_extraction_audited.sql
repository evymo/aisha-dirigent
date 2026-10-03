-- ============================================================================
-- Source of Truth: fn_apply_graph_extraction_audited
-- Step:  Step 7.2 (Hippocampus Graph extraction worker)
-- Used by: services/svc-mcp-knowledge/src/routes/graph-extract.ts
-- Migration: aisha/db/migrations/20260520040000_graph_extraction_worker.sql
-- ============================================================================
-- Expected p_extraction shape (validated below; bad shapes raise):
--   {
--     "nodes": [
--       { "entity_type": "Concept", "entity_slug": "<slug>", "entity_label": "<label>",
--         "metadata": { ... } }
--     ],
--     "edges": [
--       { "from_type": "Run", "from_slug": "<uuid::text>",
--         "to_type":   "Concept", "to_slug":   "<concept-slug>",
--         "relationship": "REFERENCES", "confidence": 0.0..1.0,
--         "metadata": { ... } }
--     ]
--   }
--
-- Constraints enforced server-side:
--   - Only 'Concept' nodes accepted. Other types are bootstrap-owned (Step 7.1).
--   - Edge relationship must be in the graph_edges CHECK enum.
--   - Edges whose source or target slug doesn't resolve to an existing
--     graph_node are SKIPPED (counted in result), not errors.
--   - Confidence clamped to [0,1].
--   - Single audit_journal row 'graph.extraction_completed' written at end.

CREATE OR REPLACE FUNCTION public.fn_apply_graph_extraction_audited(
  p_run_id      uuid,
  p_extraction  jsonb,
  p_judge_model text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_node          jsonb;
  v_edge          jsonb;
  v_entity_type   text;
  v_entity_slug   text;
  v_entity_label  text;
  v_from_type     text;
  v_from_slug     text;
  v_to_type       text;
  v_to_slug       text;
  v_relationship  text;
  v_confidence    numeric;
  v_source_id     uuid;
  v_target_id     uuid;
  v_story_id      uuid;
  v_nodes_added   int := 0;
  v_edges_added   int := 0;
  v_edges_skipped int := 0;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'p_run_id required';
  END IF;
  IF p_extraction IS NULL OR jsonb_typeof(p_extraction) != 'object' THEN
    RAISE EXCEPTION 'p_extraction must be a jsonb object';
  END IF;

  SELECT story_id INTO v_story_id FROM public.ai_runs WHERE id = p_run_id;

  FOR v_node IN SELECT jsonb_array_elements(COALESCE(p_extraction->'nodes', '[]'::jsonb))
  LOOP
    v_entity_type  := v_node->>'entity_type';
    v_entity_slug  := v_node->>'entity_slug';
    v_entity_label := v_node->>'entity_label';

    CONTINUE WHEN v_entity_type IS DISTINCT FROM 'Concept';
    CONTINUE WHEN v_entity_slug IS NULL OR length(trim(v_entity_slug)) = 0;
    CONTINUE WHEN v_entity_label IS NULL OR length(trim(v_entity_label)) = 0;

    INSERT INTO public.graph_nodes (
      entity_type, entity_slug, entity_label, source_table, source_id,
      story_id, metadata
    ) VALUES (
      'Concept', v_entity_slug, v_entity_label, NULL, NULL,
      v_story_id, COALESCE(v_node->'metadata', '{}'::jsonb)
    )
    ON CONFLICT (entity_type, entity_slug, story_id) DO UPDATE
      SET entity_label = EXCLUDED.entity_label,
          metadata     = EXCLUDED.metadata,
          updated_at   = now();
    v_nodes_added := v_nodes_added + 1;
  END LOOP;

  FOR v_edge IN SELECT jsonb_array_elements(COALESCE(p_extraction->'edges', '[]'::jsonb))
  LOOP
    v_from_type    := v_edge->>'from_type';
    v_from_slug    := v_edge->>'from_slug';
    v_to_type      := v_edge->>'to_type';
    v_to_slug      := v_edge->>'to_slug';
    v_relationship := v_edge->>'relationship';
    v_confidence   := GREATEST(0.0, LEAST(1.0, COALESCE((v_edge->>'confidence')::numeric, 0.7)));

    IF v_from_type IS NULL OR v_from_slug IS NULL
       OR v_to_type IS NULL OR v_to_slug IS NULL
       OR v_relationship IS NULL THEN
      v_edges_skipped := v_edges_skipped + 1;
      CONTINUE;
    END IF;

    SELECT id INTO v_source_id FROM public.graph_nodes
      WHERE entity_type = v_from_type AND entity_slug = v_from_slug
      ORDER BY (story_id = v_story_id) DESC NULLS LAST, created_at ASC
      LIMIT 1;
    SELECT id INTO v_target_id FROM public.graph_nodes
      WHERE entity_type = v_to_type AND entity_slug = v_to_slug
      ORDER BY (story_id = v_story_id) DESC NULLS LAST, created_at ASC
      LIMIT 1;

    IF v_source_id IS NULL OR v_target_id IS NULL THEN
      v_edges_skipped := v_edges_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.graph_edges (
        source_node_id, target_node_id, relationship, confidence,
        source_audit_journal_id, source_ai_run_id, metadata
      ) VALUES (
        v_source_id, v_target_id, v_relationship, v_confidence,
        NULL, p_run_id, COALESCE(v_edge->'metadata', '{}'::jsonb)
      )
      ON CONFLICT (source_node_id, target_node_id, relationship) DO UPDATE
        SET confidence       = EXCLUDED.confidence,
            source_ai_run_id = COALESCE(EXCLUDED.source_ai_run_id, graph_edges.source_ai_run_id),
            metadata         = EXCLUDED.metadata;
      v_edges_added := v_edges_added + 1;
    EXCEPTION WHEN check_violation THEN
      v_edges_skipped := v_edges_skipped + 1;
    END;
  END LOOP;

  INSERT INTO public.audit_journal (
    action_type, action, area, severity, summary, metadata, ai_run_id
  ) VALUES (
    'graph.extraction_completed',
    'graph.extraction_completed',
    'retrieval',
    'info',
    format('Graph extraction completed for run %s', p_run_id),
    jsonb_build_object(
      'run_id',          p_run_id,
      'nodes_added',     v_nodes_added,
      'edges_added',     v_edges_added,
      'edges_skipped',   v_edges_skipped,
      'judge_model',     p_judge_model,
      'extraction_size', jsonb_build_object(
        'node_count', jsonb_array_length(COALESCE(p_extraction->'nodes', '[]'::jsonb)),
        'edge_count', jsonb_array_length(COALESCE(p_extraction->'edges', '[]'::jsonb))
      )
    ),
    p_run_id
  );

  RETURN jsonb_build_object(
    'run_id',        p_run_id,
    'nodes_added',   v_nodes_added,
    'edges_added',   v_edges_added,
    'edges_skipped', v_edges_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_apply_graph_extraction_audited(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_apply_graph_extraction_audited(uuid, jsonb, text) TO service_role;

COMMENT ON FUNCTION public.fn_apply_graph_extraction_audited(uuid, jsonb, text) IS
  'Step 7.2: validates + applies an LLM extraction (Concept nodes + edges) for one ai_run and writes the graph.extraction_completed audit row that drives the "needs extract" filter. Atomic per call.';

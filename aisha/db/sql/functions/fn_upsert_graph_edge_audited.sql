-- Source of Truth: fn_upsert_graph_edge_audited (Step 7)
-- Migration: aisha/db/migrations/20260518270000_hippocampus_graph.sql

CREATE OR REPLACE FUNCTION public.fn_upsert_graph_edge_audited(
  p_source_node_id           uuid,
  p_target_node_id           uuid,
  p_relationship             text,
  p_confidence               numeric,
  p_source_audit_journal_id  uuid,
  p_source_ai_run_id         uuid,
  p_metadata                 jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;
  IF p_source_node_id IS NULL OR p_target_node_id IS NULL OR p_relationship IS NULL THEN
    RAISE EXCEPTION 'source, target, relationship required';
  END IF;

  INSERT INTO public.graph_edges (
    source_node_id, target_node_id, relationship, confidence,
    source_audit_journal_id, source_ai_run_id, metadata
  ) VALUES (
    p_source_node_id, p_target_node_id, p_relationship,
    COALESCE(p_confidence, 1.0),
    p_source_audit_journal_id, p_source_ai_run_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (source_node_id, target_node_id, relationship) DO UPDATE
    SET confidence = EXCLUDED.confidence,
        source_audit_journal_id = COALESCE(EXCLUDED.source_audit_journal_id, graph_edges.source_audit_journal_id),
        source_ai_run_id = COALESCE(EXCLUDED.source_ai_run_id, graph_edges.source_ai_run_id),
        metadata = EXCLUDED.metadata
  RETURNING id INTO v_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'graph.edge_upserted',
    jsonb_build_object('edge_id', v_id, 'source', p_source_node_id,
      'target', p_target_node_id, 'relationship', p_relationship));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_upsert_graph_edge_audited(uuid, uuid, text, numeric, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_upsert_graph_edge_audited(uuid, uuid, text, numeric, uuid, uuid, jsonb) TO service_role;

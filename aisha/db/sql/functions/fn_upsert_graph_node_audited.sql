-- Source of Truth: fn_upsert_graph_node_audited (Step 7)
-- Migration: aisha/db/migrations/20260518270000_hippocampus_graph.sql

CREATE OR REPLACE FUNCTION public.fn_upsert_graph_node_audited(
  p_entity_type  text,
  p_entity_slug  text,
  p_entity_label text,
  p_source_table text,
  p_source_id    uuid,
  p_story_id     uuid,
  p_metadata     jsonb
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
  IF p_entity_type IS NULL OR p_entity_label IS NULL THEN
    RAISE EXCEPTION 'p_entity_type and p_entity_label required';
  END IF;

  INSERT INTO public.graph_nodes (
    entity_type, entity_slug, entity_label, source_table, source_id, story_id, metadata
  ) VALUES (
    p_entity_type, p_entity_slug, p_entity_label, p_source_table, p_source_id,
    p_story_id, COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (entity_type, entity_slug, story_id) DO UPDATE
    SET entity_label = EXCLUDED.entity_label,
        source_table = EXCLUDED.source_table,
        source_id    = EXCLUDED.source_id,
        metadata     = EXCLUDED.metadata,
        updated_at   = now()
  RETURNING id INTO v_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'graph.node_upserted',
    jsonb_build_object('node_id', v_id, 'entity_type', p_entity_type, 'label', p_entity_label));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_upsert_graph_node_audited(text, text, text, text, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_upsert_graph_node_audited(text, text, text, text, uuid, uuid, jsonb) TO service_role;

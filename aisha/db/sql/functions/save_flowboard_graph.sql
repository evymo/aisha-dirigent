-- ============================================================================
-- Source of Truth: save_flowboard_graph
-- Popis: Insert (p_id NULL) or version-bumping update of a flowboard graph.
--        Owner-scoped (auth.uid()), admin/staff may update any. RPC-only write
--        path (direct DML is service_role). Returns the saved row as jsonb.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.save_flowboard_graph(
  p_graph      jsonb,
  p_name       text DEFAULT NULL,
  p_id         uuid DEFAULT NULL,
  p_engine_pin text DEFAULT NULL,
  p_status     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.flowboard_graphs;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING errcode = '42501';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.flowboard_graphs (name, graph, status, engine_pin, created_by)
    VALUES (COALESCE(p_name, 'Nový flow'), p_graph, COALESCE(p_status, 'draft'), p_engine_pin, v_uid)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.flowboard_graphs
       SET graph = p_graph, name = COALESCE(p_name, name), status = COALESCE(p_status, status),
           engine_pin = COALESCE(p_engine_pin, engine_pin), version = version + 1, updated_at = now()
     WHERE id = p_id AND (created_by = v_uid OR is_admin_or_staff())
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'flowboard graph % not found or not owned', p_id USING errcode = '42501';
    END IF;
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.save_flowboard_graph(jsonb, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_flowboard_graph(jsonb, text, uuid, text, text) TO authenticated, service_role;

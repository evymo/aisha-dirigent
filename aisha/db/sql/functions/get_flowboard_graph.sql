-- ============================================================================
-- Source of Truth: get_flowboard_graph
-- Popis: Fetch one flowboard graph by id, owner-scoped (admin/staff see all).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_flowboard_graph(p_id uuid)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT to_jsonb(g) FROM public.flowboard_graphs g
   WHERE g.id = p_id AND (g.created_by = auth.uid() OR is_admin_or_staff());
$$;
REVOKE ALL ON FUNCTION public.get_flowboard_graph(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_flowboard_graph(uuid) TO authenticated, service_role;

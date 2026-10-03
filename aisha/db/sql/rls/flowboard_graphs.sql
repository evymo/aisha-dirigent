-- RLS: flowboard_graphs — owner-scoped, admin/staff see all. RPC-only writes.

ALTER TABLE public.flowboard_graphs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flowboard_graphs_select ON public.flowboard_graphs;
CREATE POLICY flowboard_graphs_select ON public.flowboard_graphs
  FOR SELECT USING (created_by = auth.uid() OR (SELECT is_admin_or_staff()));

DROP POLICY IF EXISTS flowboard_graphs_insert ON public.flowboard_graphs;
CREATE POLICY flowboard_graphs_insert ON public.flowboard_graphs
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS flowboard_graphs_update ON public.flowboard_graphs;
CREATE POLICY flowboard_graphs_update ON public.flowboard_graphs
  FOR UPDATE USING (created_by = auth.uid() OR (SELECT is_admin_or_staff()));

DROP POLICY IF EXISTS flowboard_graphs_delete ON public.flowboard_graphs;
CREATE POLICY flowboard_graphs_delete ON public.flowboard_graphs
  FOR DELETE USING (created_by = auth.uid() OR (SELECT is_admin_or_staff()));

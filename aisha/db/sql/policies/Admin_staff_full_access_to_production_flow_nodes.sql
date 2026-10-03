-- Policy: Admin/staff full access to production_flow_nodes

DROP POLICY IF EXISTS "Admin/staff full access to production_flow_nodes" ON public.production_flow_nodes;
CREATE POLICY "Admin/staff full access to production_flow_nodes" ON public.production_flow_nodes
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()))
  WITH CHECK ((SELECT is_admin_or_staff()));

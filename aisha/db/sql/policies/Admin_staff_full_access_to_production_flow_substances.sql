-- Policy: Admin/staff full access to production_flow_substances

DROP POLICY IF EXISTS "Admin/staff full access to production_flow_substances" ON public.production_flow_substances;
CREATE POLICY "Admin/staff full access to production_flow_substances" ON public.production_flow_substances
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()))
  WITH CHECK ((SELECT is_admin_or_staff()));

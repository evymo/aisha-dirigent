-- Policy: Admin/staff full access to production_flow_records

DROP POLICY IF EXISTS "Admin/staff full access to production_flow_records" ON public.production_flow_records;
CREATE POLICY "Admin/staff full access to production_flow_records" ON public.production_flow_records
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()))
  WITH CHECK ((SELECT is_admin_or_staff()));

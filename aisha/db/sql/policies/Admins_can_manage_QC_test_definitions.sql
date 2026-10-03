-- Policy: Admins can manage QC test definitions

DROP POLICY IF EXISTS "Admins can manage QC test definitions" ON public.production_qc_test_definitions;
CREATE POLICY "Admins can manage QC test definitions" ON public.production_qc_test_definitions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

-- Policy: Authenticated can read QC test definitions

CREATE POLICY "Authenticated can read QC test definitions" ON public.production_qc_test_definitions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));

-- Policy: Admins can manage reference ranges

DROP POLICY IF EXISTS "Admins can manage reference ranges" ON public.biomarker_reference_ranges;
CREATE POLICY "Admins can manage reference ranges" ON public.biomarker_reference_ranges
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));

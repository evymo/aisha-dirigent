-- Policy: Public can view active reference ranges

CREATE POLICY "Public can view active reference ranges" ON public.biomarker_reference_ranges
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));

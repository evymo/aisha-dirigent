-- Policy: Authenticated can view active protocols

CREATE POLICY "Authenticated can view active protocols" ON public.study_distribution_protocols
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((is_active = true) AND (auth.uid() IS NOT NULL)));

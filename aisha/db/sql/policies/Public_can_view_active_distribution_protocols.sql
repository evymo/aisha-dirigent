-- Policy: Public can view active distribution protocols

CREATE POLICY "Public can view active distribution protocols" ON public.distribution_protocols
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));

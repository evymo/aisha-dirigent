-- Policy: Public can view active consent template versions

CREATE POLICY "Public can view active consent template versions" ON public.consent_template_versions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));

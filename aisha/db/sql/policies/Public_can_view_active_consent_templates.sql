-- Policy: Public can view active consent templates

CREATE POLICY "Public can view active consent templates" ON public.consent_templates
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));

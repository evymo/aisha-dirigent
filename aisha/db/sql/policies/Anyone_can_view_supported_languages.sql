-- Policy: Anyone can view supported languages

CREATE POLICY "Anyone can view supported languages" ON public.supported_languages
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));

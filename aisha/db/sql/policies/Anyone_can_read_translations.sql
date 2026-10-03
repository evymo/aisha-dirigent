-- Policy: Anyone can read translations

CREATE POLICY "Anyone can read translations" ON public.translations
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);

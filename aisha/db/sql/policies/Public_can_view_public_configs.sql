-- Policy: Public can view public configs

CREATE POLICY "Public can view public configs" ON public.system_config
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_public = true));

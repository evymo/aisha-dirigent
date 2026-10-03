-- Policy: Public can view token config

CREATE POLICY "Public can view token config" ON public.token_config
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));

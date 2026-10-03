-- Policy: Admins can manage token config

DROP POLICY IF EXISTS "Admins can manage token config" ON public.token_config;
CREATE POLICY "Admins can manage token config" ON public.token_config
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

-- Policy: Admins can manage secrets

DROP POLICY IF EXISTS "Admins can manage secrets" ON public.app_secrets;
CREATE POLICY "Admins can manage secrets" ON public.app_secrets
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));

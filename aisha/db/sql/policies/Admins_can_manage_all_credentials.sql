-- Policy: Admins can manage all credentials

DROP POLICY IF EXISTS "Admins can manage all credentials" ON public.production_credentials;
CREATE POLICY "Admins can manage all credentials" ON public.production_credentials
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));

-- Policy: Admins can manage app versions

DROP POLICY IF EXISTS "Admins can manage app versions" ON public.app_versions;
CREATE POLICY "Admins can manage app versions" ON public.app_versions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));

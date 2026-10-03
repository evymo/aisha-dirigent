-- Policy: Admins can view app versions

DROP POLICY IF EXISTS "Admins can view app versions" ON public.app_versions;
CREATE POLICY "Admins can view app versions" ON public.app_versions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));

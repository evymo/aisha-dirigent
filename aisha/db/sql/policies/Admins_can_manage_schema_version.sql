-- Policy: Admins can manage schema version

DROP POLICY IF EXISTS "Admins can manage schema version" ON public.schema_version;
CREATE POLICY "Admins can manage schema version" ON public.schema_version
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

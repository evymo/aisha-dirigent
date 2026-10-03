-- Policy: Authenticated users can view role permissions

CREATE POLICY "Authenticated users can view role permissions" ON public.app_role_permissions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));

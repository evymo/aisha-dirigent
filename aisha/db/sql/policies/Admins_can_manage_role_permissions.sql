-- Policy: Admins can manage role permissions

DROP POLICY IF EXISTS "Admins can manage role permissions" ON public.app_role_permissions;
CREATE POLICY "Admins can manage role permissions" ON public.app_role_permissions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));

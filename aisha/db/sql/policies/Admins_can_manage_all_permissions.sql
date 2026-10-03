-- Policy: Admins can manage all permissions

DROP POLICY IF EXISTS "Admins can manage all permissions" ON public.document_sharing_permissions;
CREATE POLICY "Admins can manage all permissions" ON public.document_sharing_permissions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))))
  WITH CHECK ((SELECT is_admin_or_staff((SELECT auth.uid()))));

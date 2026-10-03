-- Policy: Admins and staff can view audit logs

DROP POLICY IF EXISTS "Admins and staff can view audit logs" ON public.audit_logs;
CREATE POLICY "Admins and staff can view audit logs" ON public.audit_logs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

-- Admin/staff may READ the workbench work queue (observability). The extension's
-- claim/complete go through SECURITY DEFINER RPCs, so no authenticated DML policy is needed.
DROP POLICY IF EXISTS "Admin staff can read workbench requests" ON public.workbench_execution_requests;
CREATE POLICY "Admin staff can read workbench requests" ON public.workbench_execution_requests
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

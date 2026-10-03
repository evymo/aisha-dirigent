-- Policies: approval_requests
-- Admin/staff may read approval requests (intranet approval UI). Writes go through
-- the SECURITY DEFINER RPCs (service_role, RLS-bypassing). No anon access.

DROP POLICY IF EXISTS "Admin can view approval requests" ON public.approval_requests;
CREATE POLICY "Admin can view approval requests" ON public.approval_requests
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

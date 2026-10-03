-- Policy: Admins can update deletion requests

DROP POLICY IF EXISTS "Admins can update deletion requests" ON public.account_deletion_requests;
CREATE POLICY "Admins can update deletion requests" ON public.account_deletion_requests
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))))
  WITH CHECK ((SELECT is_admin_or_staff((SELECT auth.uid()))));

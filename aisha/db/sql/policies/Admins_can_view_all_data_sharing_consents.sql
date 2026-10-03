-- Policy: Admins can view all data sharing consents

DROP POLICY IF EXISTS "Admins can view all data sharing consents" ON public.data_sharing_consents;
CREATE POLICY "Admins can view all data sharing consents" ON public.data_sharing_consents
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

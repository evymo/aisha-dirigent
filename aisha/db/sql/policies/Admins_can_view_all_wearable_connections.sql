-- Policy: Admins can view all wearable connections

DROP POLICY IF EXISTS "Admins can view all wearable connections" ON public.member_wearable_connections;
CREATE POLICY "Admins can view all wearable connections" ON public.member_wearable_connections
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

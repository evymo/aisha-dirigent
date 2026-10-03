-- Policy: Admins can view all wearables data

DROP POLICY IF EXISTS "Admins can view all wearables data" ON public.wearables_data;
CREATE POLICY "Admins can view all wearables data" ON public.wearables_data
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

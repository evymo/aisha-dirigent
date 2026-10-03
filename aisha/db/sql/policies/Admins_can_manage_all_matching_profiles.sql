-- Policy: Admins can manage all matching profiles

DROP POLICY IF EXISTS "Admins can manage all matching profiles" ON public.partner_matching_profiles;
CREATE POLICY "Admins can manage all matching profiles" ON public.partner_matching_profiles
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

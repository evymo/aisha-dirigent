-- Policy: Admins can manage all partner profiles

DROP POLICY IF EXISTS "Admins can manage all partner profiles" ON public.partner_profiles;
CREATE POLICY "Admins can manage all partner profiles" ON public.partner_profiles
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

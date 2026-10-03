-- Policy: Admins can manage packages

DROP POLICY IF EXISTS "Admins can manage packages" ON public.subscription_packages;
CREATE POLICY "Admins can manage packages" ON public.subscription_packages
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

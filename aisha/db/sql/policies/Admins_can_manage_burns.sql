-- Policy: Admins can manage burns

DROP POLICY IF EXISTS "Admins can manage burns" ON public.token_burns;
CREATE POLICY "Admins can manage burns" ON public.token_burns
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

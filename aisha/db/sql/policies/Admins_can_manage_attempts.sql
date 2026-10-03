-- Policy: Admins can manage attempts

DROP POLICY IF EXISTS "Admins can manage attempts" ON public.test_attempts;
CREATE POLICY "Admins can manage attempts" ON public.test_attempts
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

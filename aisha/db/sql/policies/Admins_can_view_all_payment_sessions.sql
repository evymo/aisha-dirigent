-- Policy: Admins can view all payment sessions

DROP POLICY IF EXISTS "Admins can view all payment sessions" ON public.payment_sessions;
CREATE POLICY "Admins can view all payment sessions" ON public.payment_sessions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

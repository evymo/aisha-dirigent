-- Policy: Admin can view all sessions

DROP POLICY IF EXISTS "Admin can view all sessions" ON public.user_sessions;
CREATE POLICY "Admin can view all sessions" ON public.user_sessions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

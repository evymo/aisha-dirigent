-- Policy: Admin can delete all sessions

DROP POLICY IF EXISTS "Admin can delete all sessions" ON public.user_sessions;
CREATE POLICY "Admin can delete all sessions" ON public.user_sessions
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

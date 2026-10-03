-- Policy: Admin can manage all AI sessions

DROP POLICY IF EXISTS "Admin can manage all AI sessions" ON public.story_ai_sessions;
CREATE POLICY "Admin can manage all AI sessions" ON public.story_ai_sessions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

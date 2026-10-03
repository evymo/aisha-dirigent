-- Policy: user_read_own_sessions

CREATE POLICY "user_read_own_sessions" ON public.moderation_sessions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()));

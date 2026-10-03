-- Policy: user_create_own_sessions

CREATE POLICY "user_create_own_sessions" ON public.moderation_sessions
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((user_id = auth.uid()));

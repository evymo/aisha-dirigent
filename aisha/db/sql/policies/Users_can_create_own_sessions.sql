-- Policy: Users can create own sessions

CREATE POLICY "Users can create own sessions" ON public.user_sessions
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));

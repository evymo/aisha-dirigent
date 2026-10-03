-- Policy: Users can update own sessions

CREATE POLICY "Users can update own sessions" ON public.user_sessions
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

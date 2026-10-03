-- Policy: Users can delete own sessions

CREATE POLICY "Users can delete own sessions" ON public.user_sessions
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((auth.uid() = user_id));

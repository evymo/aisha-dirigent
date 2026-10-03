-- Policy: Users can view own sessions

CREATE POLICY "Users can view own sessions" ON public.user_sessions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));

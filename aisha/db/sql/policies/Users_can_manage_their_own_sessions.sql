-- Policy: Users can manage their own sessions

CREATE POLICY "Users can manage their own sessions" ON public.mobile_sessions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((user_id = auth.uid()));

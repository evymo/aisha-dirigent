-- Policy: Participants can view their sessions

CREATE POLICY "Participants can view their sessions" ON public.consultation_sessions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((auth.uid() = caller_id) OR (auth.uid() = callee_id)));

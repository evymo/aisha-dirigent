-- Policy: Participants can update their sessions

CREATE POLICY "Participants can update their sessions" ON public.consultation_sessions
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((auth.uid() = caller_id) OR (auth.uid() = callee_id)));

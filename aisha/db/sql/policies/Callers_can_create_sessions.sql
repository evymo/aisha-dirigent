-- Policy: Callers can create sessions

CREATE POLICY "Callers can create sessions" ON public.consultation_sessions
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = caller_id));

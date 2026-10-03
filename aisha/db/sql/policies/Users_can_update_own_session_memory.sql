-- Policy: Users can update own session memory

CREATE POLICY "Users can update own session memory" ON public.ai_session_memory
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

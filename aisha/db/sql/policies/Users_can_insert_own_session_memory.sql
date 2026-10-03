-- Policy: Users can insert own session memory

CREATE POLICY "Users can insert own session memory" ON public.ai_session_memory
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));

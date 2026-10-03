-- Policy: Users can read own session memory

CREATE POLICY "Users can read own session memory" ON public.ai_session_memory
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));

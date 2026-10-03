-- Policy: Users can delete own session memory

CREATE POLICY "Users can delete own session memory" ON public.ai_session_memory
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((auth.uid() = user_id));

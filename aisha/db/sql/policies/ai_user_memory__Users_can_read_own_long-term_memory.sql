-- Policy: Users can read own long-term memory

CREATE POLICY "Users can read own long-term memory" ON public.ai_user_memory
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));

-- Policy: Users can read own tasks

CREATE POLICY "Users can read own tasks" ON public.ai_tasks
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));

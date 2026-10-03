-- Policy: Users can create own tasks

CREATE POLICY "Users can create own tasks" ON public.ai_tasks
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));

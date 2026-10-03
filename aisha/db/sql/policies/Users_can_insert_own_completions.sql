-- Policy: Users can insert own completions

CREATE POLICY "Users can insert own completions" ON public.reminder_completions
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));

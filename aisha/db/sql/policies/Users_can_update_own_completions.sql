-- Policy: Users can update own completions

CREATE POLICY "Users can update own completions" ON public.reminder_completions
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

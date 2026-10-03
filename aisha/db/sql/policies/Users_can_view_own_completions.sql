-- Policy: Users can view own completions

CREATE POLICY "Users can view own completions" ON public.reminder_completions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));

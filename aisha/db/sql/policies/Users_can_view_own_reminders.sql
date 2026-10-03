-- Policy: Users can view own reminders

CREATE POLICY "Users can view own reminders" ON public.user_reminders
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));

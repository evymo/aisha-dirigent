-- Policy: Users can create own reminders

CREATE POLICY "Users can create own reminders" ON public.user_reminders
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));

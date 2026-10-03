-- Policy: Users can update own reminders

CREATE POLICY "Users can update own reminders" ON public.user_reminders
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

-- Policy: Users can delete own reminders

CREATE POLICY "Users can delete own reminders" ON public.user_reminders
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((auth.uid() = user_id));

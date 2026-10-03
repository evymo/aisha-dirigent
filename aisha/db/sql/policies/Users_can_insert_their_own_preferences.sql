-- Policy: Users can insert their own preferences

CREATE POLICY "Users can insert their own preferences" ON public.notification_preferences
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((user_id = auth.uid()));

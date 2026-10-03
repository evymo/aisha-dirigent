-- Policy: Users can update their own preferences

CREATE POLICY "Users can update their own preferences" ON public.notification_preferences
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

-- Policy: Users can view their own preferences

CREATE POLICY "Users can view their own preferences" ON public.notification_preferences
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()));

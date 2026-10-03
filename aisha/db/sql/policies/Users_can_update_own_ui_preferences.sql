-- Policy: Users can update own ui preferences

CREATE POLICY "Users can update own ui preferences" ON public.user_ui_preferences
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

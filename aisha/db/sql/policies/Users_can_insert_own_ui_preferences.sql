-- Policy: Users can insert own ui preferences

CREATE POLICY "Users can insert own ui preferences" ON public.user_ui_preferences
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));

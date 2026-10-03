-- Policy: Users can view own ui preferences

CREATE POLICY "Users can view own ui preferences" ON public.user_ui_preferences
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));

-- Policy: Users can view own achievements

CREATE POLICY "Users can view own achievements" ON public.user_achievements
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));

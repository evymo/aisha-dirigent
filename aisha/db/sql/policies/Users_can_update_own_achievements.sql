-- Policy: Users can update own achievements

CREATE POLICY "Users can update own achievements" ON public.user_achievements
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

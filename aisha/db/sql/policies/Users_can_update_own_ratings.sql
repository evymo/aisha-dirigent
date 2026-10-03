-- Policy: Users can update own ratings

CREATE POLICY "Users can update own ratings" ON public.study_ratings
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

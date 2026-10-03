-- Policy: Users can create own ratings

CREATE POLICY "Users can create own ratings" ON public.study_ratings
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));

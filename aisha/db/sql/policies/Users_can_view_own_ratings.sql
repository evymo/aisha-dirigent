-- Policy: Users can view own ratings

CREATE POLICY "Users can view own ratings" ON public.study_ratings
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));

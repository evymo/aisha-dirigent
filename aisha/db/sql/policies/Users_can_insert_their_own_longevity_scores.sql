-- Policy: Users can insert their own longevity scores

CREATE POLICY "Users can insert their own longevity scores" ON public.longevity_scores
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));

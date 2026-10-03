-- Policy: Users can update their own longevity scores

CREATE POLICY "Users can update their own longevity scores" ON public.longevity_scores
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

-- Policy: Users can view their own longevity scores

CREATE POLICY "Users can view their own longevity scores" ON public.longevity_scores
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));

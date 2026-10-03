-- Policy: Authenticated users can read ratings

CREATE POLICY "Authenticated users can read ratings" ON public.expert_rule_ratings
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);

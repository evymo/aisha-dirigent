-- Policy: Users can manage own ratings

CREATE POLICY "Users can manage own ratings" ON public.expert_rule_ratings
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.uid() = user_id));

CREATE POLICY "Users can view own reward claims"
  ON public.reward_claims
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can read own subscriptions

CREATE POLICY "Users can read own subscriptions" ON public.expert_rule_subscriptions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));

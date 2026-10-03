-- Policy: Users can manage own subscriptions

CREATE POLICY "Users can manage own subscriptions" ON public.expert_rule_subscriptions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.uid() = user_id));

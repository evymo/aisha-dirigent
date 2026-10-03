-- Policy: Public can view reward rules

CREATE POLICY "Public can view reward rules" ON public.token_reward_rules
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));

-- Policy: Admins can manage reward rules

DROP POLICY IF EXISTS "Admins can manage reward rules" ON public.token_reward_rules;
CREATE POLICY "Admins can manage reward rules" ON public.token_reward_rules
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

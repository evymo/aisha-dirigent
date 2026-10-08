-- Grants: expert_rule_subscriptions

GRANT SELECT ON public.expert_rule_subscriptions TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.expert_rule_subscriptions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expert_rule_subscriptions TO service_role;

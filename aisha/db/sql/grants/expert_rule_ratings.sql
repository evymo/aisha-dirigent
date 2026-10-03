-- Grants: expert_rule_ratings

GRANT SELECT ON public.expert_rule_ratings TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expert_rule_ratings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expert_rule_ratings TO service_role;

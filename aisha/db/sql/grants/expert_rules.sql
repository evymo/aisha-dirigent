-- Grants: expert_rules
-- Updated: anon has SELECT only (migration 20260328174913)

GRANT SELECT ON public.expert_rules TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.expert_rules TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expert_rules TO service_role;

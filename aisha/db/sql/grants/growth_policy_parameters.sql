-- Grants: growth_policy_parameters

GRANT SELECT ON public.growth_policy_parameters TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.growth_policy_parameters TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.growth_policy_parameters TO service_role;

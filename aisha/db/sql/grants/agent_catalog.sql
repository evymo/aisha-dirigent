-- Grants: agent_catalog

GRANT SELECT ON public.agent_catalog TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.agent_catalog TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.agent_catalog TO service_role;

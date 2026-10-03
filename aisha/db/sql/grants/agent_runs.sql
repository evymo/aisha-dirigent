-- Grants: agent_runs

GRANT SELECT ON public.agent_runs TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.agent_runs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.agent_runs TO service_role;

-- Grants: agent_memories

GRANT SELECT ON public.agent_memories TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.agent_memories TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.agent_memories TO service_role;

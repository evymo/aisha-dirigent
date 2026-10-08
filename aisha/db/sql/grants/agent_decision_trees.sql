-- Grants: agent_decision_trees

GRANT SELECT ON public.agent_decision_trees TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.agent_decision_trees TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.agent_decision_trees TO service_role;

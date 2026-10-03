-- Grants: agent_knowledge_bindings
REVOKE ALL ON TABLE public.agent_knowledge_bindings FROM PUBLIC;
GRANT SELECT ON TABLE public.agent_knowledge_bindings TO authenticated;
GRANT ALL ON TABLE public.agent_knowledge_bindings TO service_role;

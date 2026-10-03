-- Grants: evidence registry čtveřice (anon floor dle #566 — anon nemá nic).
REVOKE ALL ON public.agent_knowledge_sources, public.document_registry,
              public.contract_register, public.obligation_register FROM PUBLIC;
REVOKE ALL ON public.agent_knowledge_sources, public.document_registry,
              public.contract_register, public.obligation_register FROM anon;

GRANT SELECT ON public.agent_knowledge_sources, public.document_registry,
                public.contract_register, public.obligation_register TO authenticated;

GRANT ALL ON public.agent_knowledge_sources, public.document_registry,
             public.contract_register, public.obligation_register TO service_role;

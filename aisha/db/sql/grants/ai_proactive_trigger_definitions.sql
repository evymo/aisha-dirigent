-- Grants: ai_proactive_trigger_definitions

GRANT SELECT ON public.ai_proactive_trigger_definitions TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.ai_proactive_trigger_definitions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ai_proactive_trigger_definitions TO service_role;

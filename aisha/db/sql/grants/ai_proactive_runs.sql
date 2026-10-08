-- Grants: ai_proactive_runs

GRANT SELECT ON public.ai_proactive_runs TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.ai_proactive_runs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ai_proactive_runs TO service_role;

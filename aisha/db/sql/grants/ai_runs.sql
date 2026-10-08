-- Grants: ai_runs

GRANT SELECT ON public.ai_runs TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.ai_runs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ai_runs TO service_role;

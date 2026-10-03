-- Grants: ai_scheduled_jobs

GRANT SELECT ON public.ai_scheduled_jobs TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ai_scheduled_jobs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ai_scheduled_jobs TO service_role;

-- Grants: ai_golden_examples

GRANT SELECT ON public.ai_golden_examples TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ai_golden_examples TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ai_golden_examples TO service_role;

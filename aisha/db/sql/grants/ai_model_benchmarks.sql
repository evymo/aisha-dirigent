-- Grants: ai_model_benchmarks

GRANT SELECT ON public.ai_model_benchmarks TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ai_model_benchmarks TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ai_model_benchmarks TO service_role;

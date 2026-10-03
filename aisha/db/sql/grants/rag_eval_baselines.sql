-- Grants: rag_eval_baselines

GRANT SELECT ON public.rag_eval_baselines TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.rag_eval_baselines TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rag_eval_baselines TO service_role;

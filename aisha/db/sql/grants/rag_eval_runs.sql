-- Grants: rag_eval_runs

GRANT SELECT ON public.rag_eval_runs TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.rag_eval_runs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rag_eval_runs TO service_role;

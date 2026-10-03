-- Grants: rag_eval_golden

GRANT SELECT ON public.rag_eval_golden TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.rag_eval_golden TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rag_eval_golden TO service_role;

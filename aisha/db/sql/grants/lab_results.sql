-- Grants: lab_results

GRANT SELECT ON public.lab_results TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.lab_results TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.lab_results TO service_role;

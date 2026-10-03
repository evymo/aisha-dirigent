-- Grants: symptom_catalog

GRANT SELECT ON public.symptom_catalog TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.symptom_catalog TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.symptom_catalog TO service_role;

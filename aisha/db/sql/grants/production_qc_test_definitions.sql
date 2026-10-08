-- Grants: production_qc_test_definitions

GRANT SELECT ON public.production_qc_test_definitions TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_qc_test_definitions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_qc_test_definitions TO service_role;

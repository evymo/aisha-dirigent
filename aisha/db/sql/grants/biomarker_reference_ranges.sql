-- Grants: biomarker_reference_ranges

GRANT SELECT ON public.biomarker_reference_ranges TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.biomarker_reference_ranges TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.biomarker_reference_ranges TO service_role;

-- Grants: study_distribution_protocols

GRANT SELECT ON public.study_distribution_protocols TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.study_distribution_protocols TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.study_distribution_protocols TO service_role;

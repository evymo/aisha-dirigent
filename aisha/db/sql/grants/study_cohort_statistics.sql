-- Grants: study_cohort_statistics

GRANT SELECT ON public.study_cohort_statistics TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.study_cohort_statistics TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.study_cohort_statistics TO service_role;

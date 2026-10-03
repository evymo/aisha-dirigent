-- Grants: study_cohort_lab_trends

GRANT SELECT ON public.study_cohort_lab_trends TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.study_cohort_lab_trends TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.study_cohort_lab_trends TO service_role;

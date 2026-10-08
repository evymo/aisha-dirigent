-- Grants: study_contributions

GRANT SELECT ON public.study_contributions TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.study_contributions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.study_contributions TO service_role;

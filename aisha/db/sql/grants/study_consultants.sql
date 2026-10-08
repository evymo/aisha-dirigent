-- Grants: study_consultants

GRANT SELECT ON public.study_consultants TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.study_consultants TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.study_consultants TO service_role;

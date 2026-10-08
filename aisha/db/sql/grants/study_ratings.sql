-- Grants: study_ratings

GRANT SELECT ON public.study_ratings TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.study_ratings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.study_ratings TO service_role;

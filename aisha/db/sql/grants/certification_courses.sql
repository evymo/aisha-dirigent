-- Grants: certification_courses

GRANT SELECT ON public.certification_courses TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.certification_courses TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.certification_courses TO service_role;

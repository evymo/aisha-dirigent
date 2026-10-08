-- Grants: translations

GRANT SELECT ON public.translations TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.translations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.translations TO service_role;

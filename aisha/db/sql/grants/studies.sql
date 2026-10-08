-- Grants: studies

GRANT SELECT ON public.studies TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.studies TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.studies TO service_role;

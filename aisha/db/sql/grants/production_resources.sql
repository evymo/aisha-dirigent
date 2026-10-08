-- Grants: production_resources

GRANT SELECT ON public.production_resources TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_resources TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_resources TO service_role;

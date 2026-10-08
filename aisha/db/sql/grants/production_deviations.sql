-- Grants: production_deviations

GRANT SELECT ON public.production_deviations TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_deviations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_deviations TO service_role;

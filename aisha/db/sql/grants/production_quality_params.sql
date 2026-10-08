-- Grants: production_quality_params

GRANT SELECT ON public.production_quality_params TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_quality_params TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_quality_params TO service_role;

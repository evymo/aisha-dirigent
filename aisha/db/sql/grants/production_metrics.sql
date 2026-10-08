-- Grants: production_metrics

GRANT SELECT ON public.production_metrics TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_metrics TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_metrics TO service_role;

-- Grants: health_metrics

GRANT SELECT ON public.health_metrics TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.health_metrics TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.health_metrics TO service_role;

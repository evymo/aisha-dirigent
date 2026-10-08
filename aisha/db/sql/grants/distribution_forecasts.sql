-- Grants: distribution_forecasts

GRANT SELECT ON public.distribution_forecasts TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.distribution_forecasts TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.distribution_forecasts TO service_role;

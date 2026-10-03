-- Grants: distribution_forecast_items

GRANT SELECT ON public.distribution_forecast_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.distribution_forecast_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.distribution_forecast_items TO service_role;

-- Grants: product_dose_units

GRANT SELECT ON public.product_dose_units TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.product_dose_units TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.product_dose_units TO service_role;

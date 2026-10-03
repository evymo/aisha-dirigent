-- Grants: distribution_adjustments_overview

GRANT SELECT ON public.distribution_adjustments_overview TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.distribution_adjustments_overview TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.distribution_adjustments_overview TO service_role;

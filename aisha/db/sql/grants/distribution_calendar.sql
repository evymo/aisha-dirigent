-- Grants: distribution_calendar

GRANT SELECT ON public.distribution_calendar TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.distribution_calendar TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.distribution_calendar TO service_role;

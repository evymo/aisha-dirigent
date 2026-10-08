-- Grants: user_distribution_schedule

GRANT SELECT ON public.user_distribution_schedule TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.user_distribution_schedule TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_distribution_schedule TO service_role;

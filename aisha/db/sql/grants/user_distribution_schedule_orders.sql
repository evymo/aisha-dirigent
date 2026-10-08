-- Grants: user_distribution_schedule_orders

GRANT SELECT ON public.user_distribution_schedule_orders TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.user_distribution_schedule_orders TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_distribution_schedule_orders TO service_role;

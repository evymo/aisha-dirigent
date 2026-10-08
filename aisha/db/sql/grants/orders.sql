-- Grants: orders

GRANT SELECT ON public.orders TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.orders TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.orders TO service_role;

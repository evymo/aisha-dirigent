-- Grants: lab_test_orders

GRANT SELECT ON public.lab_test_orders TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.lab_test_orders TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.lab_test_orders TO service_role;

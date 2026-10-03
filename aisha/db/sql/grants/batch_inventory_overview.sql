-- Grants: batch_inventory_overview

GRANT SELECT ON public.batch_inventory_overview TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.batch_inventory_overview TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.batch_inventory_overview TO service_role;

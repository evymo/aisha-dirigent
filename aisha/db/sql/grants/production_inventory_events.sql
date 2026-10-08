-- Grants: production_inventory_events

GRANT SELECT ON public.production_inventory_events TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_inventory_events TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_inventory_events TO service_role;

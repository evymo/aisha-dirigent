-- Grants: shipment_statistics

GRANT SELECT ON public.shipment_statistics TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.shipment_statistics TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.shipment_statistics TO service_role;

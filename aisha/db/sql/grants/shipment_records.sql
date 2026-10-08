-- Grants: shipment_records

GRANT SELECT ON public.shipment_records TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.shipment_records TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.shipment_records TO service_role;

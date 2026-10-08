-- Grants: user_shipment_preferences

GRANT SELECT ON public.user_shipment_preferences TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.user_shipment_preferences TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_shipment_preferences TO service_role;

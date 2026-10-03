-- Grants: member_wearable_connections

GRANT SELECT ON public.member_wearable_connections TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.member_wearable_connections TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.member_wearable_connections TO service_role;

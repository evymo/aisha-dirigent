-- Grants: blockchain_audit_records

GRANT SELECT ON public.blockchain_audit_records TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.blockchain_audit_records TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.blockchain_audit_records TO service_role;

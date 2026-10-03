-- Grants: account_deletion_requests

GRANT SELECT ON public.account_deletion_requests TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.account_deletion_requests TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.account_deletion_requests TO service_role;

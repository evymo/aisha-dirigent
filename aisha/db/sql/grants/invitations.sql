-- Grants: invitations
-- NO anon SELECT (audit C2 — PII/code/role leak via PostgREST). Redemption uses
-- the SECURITY DEFINER validate_invitation/claim_invitation RPCs, not table reads.
GRANT DELETE, INSERT, SELECT, UPDATE ON public.invitations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.invitations TO service_role;

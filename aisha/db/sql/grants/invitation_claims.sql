-- Grants: invitation_claims

GRANT SELECT ON public.invitation_claims TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.invitation_claims TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.invitation_claims TO service_role;

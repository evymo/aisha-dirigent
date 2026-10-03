-- Grants: partner_certifications
--
-- Certification evidence: written ONLY by submit_partner_certification (SECURITY
-- DEFINER, runs as owner). Clients get SELECT-own only — no INSERT/UPDATE/DELETE —
-- so passed=true / a certification level can never be self-asserted directly.
GRANT SELECT ON public.partner_certifications TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.partner_certifications TO service_role;

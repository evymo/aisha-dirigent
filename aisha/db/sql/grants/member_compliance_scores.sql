-- Grants: member_compliance_scores

GRANT SELECT ON public.member_compliance_scores TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.member_compliance_scores TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.member_compliance_scores TO service_role;

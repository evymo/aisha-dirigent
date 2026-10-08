-- Grants: member_health_documents

GRANT SELECT ON public.member_health_documents TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.member_health_documents TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.member_health_documents TO service_role;

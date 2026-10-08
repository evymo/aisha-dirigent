-- Grants: audit_journal

GRANT SELECT ON public.audit_journal TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.audit_journal TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.audit_journal TO service_role;

-- Grants: plugin_audit_events

GRANT SELECT ON public.plugin_audit_events TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.plugin_audit_events TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.plugin_audit_events TO service_role;

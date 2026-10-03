-- Grants: plugin_transition_rules

GRANT SELECT ON public.plugin_transition_rules TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.plugin_transition_rules TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.plugin_transition_rules TO service_role;

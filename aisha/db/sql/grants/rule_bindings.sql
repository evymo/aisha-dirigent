-- Grants: rule_bindings

GRANT SELECT ON public.rule_bindings TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.rule_bindings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.rule_bindings TO service_role;

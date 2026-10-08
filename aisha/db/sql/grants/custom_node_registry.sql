-- Grants: custom_node_registry

GRANT SELECT ON public.custom_node_registry TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.custom_node_registry TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.custom_node_registry TO service_role;

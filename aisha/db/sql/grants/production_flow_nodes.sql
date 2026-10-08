-- Grants: production_flow_nodes

GRANT SELECT ON public.production_flow_nodes TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_flow_nodes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_flow_nodes TO service_role;

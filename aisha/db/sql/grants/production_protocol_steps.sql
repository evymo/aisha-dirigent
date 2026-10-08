-- Grants: production_protocol_steps

GRANT SELECT ON public.production_protocol_steps TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.production_protocol_steps TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.production_protocol_steps TO service_role;

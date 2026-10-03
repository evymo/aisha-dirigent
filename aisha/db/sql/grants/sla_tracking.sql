-- Grants: sla_tracking

GRANT SELECT ON public.sla_tracking TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.sla_tracking TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sla_tracking TO service_role;

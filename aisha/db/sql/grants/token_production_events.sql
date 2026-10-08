-- Grants: token_production_events

GRANT SELECT ON public.token_production_events TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.token_production_events TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.token_production_events TO service_role;

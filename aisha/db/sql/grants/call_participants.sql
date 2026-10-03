-- Grants: call_participants

GRANT SELECT ON public.call_participants TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.call_participants TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.call_participants TO service_role;

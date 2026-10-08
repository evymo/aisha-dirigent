-- Grants: message_escalations

GRANT SELECT ON public.message_escalations TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.message_escalations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.message_escalations TO service_role;

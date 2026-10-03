-- Grants: message_user_feedback

GRANT SELECT ON public.message_user_feedback TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.message_user_feedback TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.message_user_feedback TO service_role;

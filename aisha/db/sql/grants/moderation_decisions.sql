-- Grants: moderation_decisions

GRANT SELECT ON public.moderation_decisions TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.moderation_decisions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.moderation_decisions TO service_role;

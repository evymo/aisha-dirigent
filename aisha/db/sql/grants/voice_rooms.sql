-- Grants: voice_rooms

GRANT SELECT ON public.voice_rooms TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.voice_rooms TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.voice_rooms TO service_role;

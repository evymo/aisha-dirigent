-- Grants: guild_member_expertise

GRANT SELECT ON public.guild_member_expertise TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.guild_member_expertise TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.guild_member_expertise TO service_role;

-- Grants: guild_expertise_areas

GRANT SELECT ON public.guild_expertise_areas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.guild_expertise_areas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.guild_expertise_areas TO service_role;

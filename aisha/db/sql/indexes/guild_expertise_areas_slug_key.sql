-- Index: guild_expertise_areas_slug_key

CREATE UNIQUE INDEX guild_expertise_areas_slug_key ON public.guild_expertise_areas USING btree (slug);

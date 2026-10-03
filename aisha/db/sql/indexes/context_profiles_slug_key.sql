-- Index: context_profiles_slug_key

CREATE UNIQUE INDEX context_profiles_slug_key ON public.context_profiles USING btree (slug);

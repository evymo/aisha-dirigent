-- Index: agent_catalog_slug_key

CREATE UNIQUE INDEX agent_catalog_slug_key ON public.agent_catalog USING btree (slug);

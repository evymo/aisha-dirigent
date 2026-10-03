-- Index: idx_agent_catalog_slug_unique
-- Auto-extracted (back-port reconciliation)

CREATE UNIQUE INDEX idx_agent_catalog_slug_unique ON public.agent_catalog USING btree (slug);

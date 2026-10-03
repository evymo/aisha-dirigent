-- Index: idx_dirigent_nudges_expires
-- Auto-extracted (back-port reconciliation)

CREATE INDEX IF NOT EXISTS idx_dirigent_nudges_expires ON public.dirigent_nudges USING btree (expires_at) WHERE (consumed_at IS NULL);

-- Index: idx_dirigent_nudges_pending
-- Auto-extracted (back-port reconciliation)

CREATE INDEX IF NOT EXISTS idx_dirigent_nudges_pending ON public.dirigent_nudges USING btree (story_id, consumed_at) WHERE (consumed_at IS NULL);

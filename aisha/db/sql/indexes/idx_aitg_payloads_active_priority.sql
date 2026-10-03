-- Index: idx_aitg_payloads_active_priority
-- Auto-extracted (back-port reconciliation)

CREATE INDEX IF NOT EXISTS idx_aitg_payloads_active_priority ON public.aitg_payloads USING btree (test_id, last_seen_at NULLS FIRST, consecutive_failures DESC) WHERE ((active = true) AND (quarantined_at IS NULL));

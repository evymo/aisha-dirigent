-- Index: idx_story_entries_inbound_external_id
-- Fast idempotency lookup for inbound-communication ingest.
-- append_inbound_comm_entry_audited dedups with:
--   WHERE entry_type = 'inbound_<channel>' AND metadata->>'external_id' = $1
-- Composite + partial (only rows that carry an external_id). The partial predicate
-- is implied by the equality filter, so the planner can use this index for the dedup.
CREATE INDEX IF NOT EXISTS idx_story_entries_inbound_external_id
  ON public.story_entries (entry_type, (metadata->>'external_id'))
  WHERE (metadata->>'external_id') IS NOT NULL;

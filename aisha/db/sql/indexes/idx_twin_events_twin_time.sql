-- Index: idx_twin_events_twin_time
-- Source of truth pair: aisha/db/sql/tables/twin_events.sql
-- Historie entity se čte „poslední události nejdřív".

CREATE INDEX IF NOT EXISTS idx_twin_events_twin_time
  ON public.twin_events (twin_id, occurred_at DESC);

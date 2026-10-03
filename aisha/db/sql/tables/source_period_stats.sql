-- Table: source_period_stats
-- RLS: ENABLED
--
-- Per-month statistics of SOURCE entities (topics / events created in that
-- month), landed by svc-source-broker's scheduler from the source adapter's
-- listStats() — the same rows an operator used to get from an on-demand CSV
-- export. ONE table for both kinds: the row shape is a superset keyed by `kind`,
-- and the surface reads kind-specific VIEWS over it. Booleans are stored as
-- booleans (truth), the views decide how to SHOW them (the table mask rejects
-- raw booleans — measured 2026-09-07, one broke a whole detail).
-- Idempotent upsert on (source_slug, kind, month, external_id): the scheduler
-- re-syncs the last months every tick, so a rename or a new follow converges.
CREATE TABLE IF NOT EXISTS public.source_period_stats (
  source_slug   text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('topic', 'event')),
  month         text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  external_id   text NOT NULL,
  title         text NOT NULL DEFAULT '',
  created_by    text NOT NULL DEFAULT '',
  created_by_id text NOT NULL DEFAULT '',
  created_at    timestamp with time zone,
  date_from     timestamp with time zone,
  date_to       timestamp with time zone,
  deleted       boolean NOT NULL DEFAULT false,
  is_private    boolean NOT NULL DEFAULT false,
  official      boolean NOT NULL DEFAULT false,
  cancelled     boolean NOT NULL DEFAULT false,
  online        boolean NOT NULL DEFAULT false,
  follow_count  integer NOT NULL DEFAULT 0,
  posts_count   integer NOT NULL DEFAULT 0,
  tags          text NOT NULL DEFAULT '',
  synced_at     timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (source_slug, kind, month, external_id)
);
-- ⛔ SLOUPCE PŘIDANÉ POZDĚJI. `CREATE TABLE IF NOT EXISTS` běžící tabulku
-- NEDOPLNÍ — na instanci, kde už tabulka je, by nový sloupec nikdy nevznikl
-- a upsert by padal na "column does not exist". Proto explicitní ALTER
-- (týž vzor jako story_labels.sql / heals „Columns the pass ADDED").
ALTER TABLE public.source_period_stats ADD COLUMN IF NOT EXISTS created_by_id text NOT NULL DEFAULT '';

ALTER TABLE public.source_period_stats ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.source_period_stats IS
  'Per-month source statistics (topics/events created in the month) synced by svc-source-broker from the source adapter listStats(). Read via audience_admin_source_*_v views; never edited by hand.';

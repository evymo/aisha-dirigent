-- Table: audience_broker_sync_state

CREATE TABLE IF NOT EXISTS public.audience_broker_sync_state (
  source_slug text NOT NULL,
  last_sync_started_at timestamp with time zone,
  last_sync_finished_at timestamp with time zone,
  last_success_at timestamp with time zone,
  last_error_at timestamp with time zone,
  last_error_message text,
  consecutive_failures integer DEFAULT 0 NOT NULL,
  total_syncs bigint DEFAULT 0 NOT NULL,
  total_failures bigint DEFAULT 0 NOT NULL,
  last_recent_active_count integer,
  last_upserted_count integer,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (source_slug)
);

ALTER TABLE public.audience_broker_sync_state ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.audience_broker_sync_state IS 'Per-data-source sync cursor + failure counters. Read at broker startup
   to resume from last_success_at instead of 24h-ago cursor. Updated after
   each runOnce() tick (success or failure).';

-- updated_at: no auto-touch trigger by design — written explicitly by the
-- audited RPCs that mutate this table (matches the deployed schema; no trigger).

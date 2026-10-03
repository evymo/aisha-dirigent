-- Table: user_engagement_metrics

CREATE TABLE IF NOT EXISTS public.user_engagement_metrics (
  user_id uuid NOT NULL,
  app_accesses_30d integer DEFAULT 0 NOT NULL,
  app_accesses_90d integer DEFAULT 0 NOT NULL,
  last_active_at timestamp with time zone,
  events_created_30d integer DEFAULT 0 NOT NULL,
  events_created_90d integer DEFAULT 0 NOT NULL,
  posts_created_30d integer DEFAULT 0 NOT NULL,
  audience_size integer DEFAULT 0 NOT NULL,
  audience_growth_30d numeric(6,4) DEFAULT 0 NOT NULL,
  unique_attendees_30d integer DEFAULT 0 NOT NULL,
  total_attendance_30d integer DEFAULT 0 NOT NULL,
  emails_opened_90d integer DEFAULT 0 NOT NULL,
  emails_sent_90d integer DEFAULT 0 NOT NULL,
  email_open_rate_90d numeric(6,4),
  email_click_rate_90d numeric(6,4),
  source_slug text,
  computed_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (user_id)
);

ALTER TABLE public.user_engagement_metrics ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.user_engagement_metrics IS 'Generic per-user engagement aggregates. Computed by data source connectors
   (e.g., svc-source-broker aggregates source-api follows + event attendances)
   and upserted via audience_upsert_user_engagement() RPC. NEVER stores raw
   event rows — only pre-computed aggregates. Used by audience_actor_*_v views
   for marketer dashboards + creator self-service.';

-- updated_at: no auto-touch trigger by design — written explicitly by the
-- audited RPCs that mutate this table (matches the deployed schema; no trigger).

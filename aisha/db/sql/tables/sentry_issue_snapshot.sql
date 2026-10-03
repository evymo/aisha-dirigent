-- Table: sentry_issue_snapshot
-- Snapshot Sentry issues, periodicky populated z Sentry API.
-- Slouží jako stabilní zdroj pro correlate_sentry_with_deploys RPC
-- (přímé volání Sentry API z RPC by bylo pomalé a vyvolalo by rate limit).
-- Source: docs/deploy/SENTRY_OBSERVER.md (Phase 3 of AUTONOMOUS_DEPLOY_FLOW.md)

CREATE TABLE IF NOT EXISTS public.sentry_issue_snapshot (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  observed_at     timestamptz  NOT NULL DEFAULT now(),
  sentry_issue_id text         NOT NULL,
  app_name        text         NOT NULL,                -- canonical (matches coolify_app_slots.app_name)
  project_slug    text         NOT NULL,                -- Sentry project slug
  level           text         NOT NULL CHECK (level IN ('fatal', 'error', 'warning', 'info', 'debug')),
  title           text         NOT NULL,
  first_seen      timestamptz  NOT NULL,
  last_seen       timestamptz  NOT NULL,
  count           int          NOT NULL DEFAULT 1,
  user_count      int          NOT NULL DEFAULT 0,
  status          text         NOT NULL,                -- 'unresolved' | 'resolved' | 'ignored'
  release         text,                                 -- Sentry release tag (mapping na image_tag)
  permalink       text,
  metadata        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (sentry_issue_id, observed_at)
);

COMMENT ON TABLE public.sentry_issue_snapshot IS
  'Snapshot Sentry issues, periodicky populated z Sentry API.  Slouží jako stabilní zdroj pro correlate_sentry_with_deploys RPC.';

ALTER TABLE public.sentry_issue_snapshot ENABLE ROW LEVEL SECURITY;

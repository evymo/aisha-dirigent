-- Table: public.sentry_project_issues
-- Caches Sentry issues + AISHA analysis results for mobile consumption

CREATE TABLE IF NOT EXISTS public.sentry_project_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.sentry_monitor_config(id) ON DELETE CASCADE,
  sentry_issue_id TEXT NOT NULL,
  title TEXT NOT NULL,
  culprit TEXT,
  level TEXT NOT NULL DEFAULT 'error',
  status TEXT NOT NULL DEFAULT 'unresolved',
  event_count INTEGER NOT NULL DEFAULT 0,
  first_seen TIMESTAMPTZ,
  last_seen TIMESTAMPTZ,
  short_id TEXT,
  aisha_analysis JSONB,
  aisha_analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(config_id, sentry_issue_id)
);

ALTER TABLE public.sentry_project_issues ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.sentry_project_issues IS
  'Cached Sentry issues with AISHA analysis results.';

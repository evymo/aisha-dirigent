-- Table: public.sentry_monitor_config
-- Maps Sentry projects to AISHA platform projects for monitoring

CREATE TABLE IF NOT EXISTS public.sentry_monitor_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_slug TEXT NOT NULL,
  sentry_org TEXT NOT NULL DEFAULT 'sentry',
  display_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  check_interval_minutes INTEGER NOT NULL DEFAULT 15,
  alert_on_levels TEXT[] NOT NULL DEFAULT ARRAY['fatal', 'error'],
  scan_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sentry_org, project_slug)
);

ALTER TABLE public.sentry_monitor_config ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.sentry_monitor_config IS
  'Configuration for Sentry project monitoring by AISHA.';
COMMENT ON COLUMN public.sentry_monitor_config.scan_url IS
  'Public URL to scan for security headers / SSL. Used by vulnerability-aggregator.';

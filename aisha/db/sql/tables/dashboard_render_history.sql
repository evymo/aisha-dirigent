-- Table: dashboard_render_history
-- Audit + idempotency log dashboard renderingem WF_APPSMITH_DASHBOARD_BUILDER.
-- Content hash umožňuje skip-if-unchanged (žádný zbytečný API call do Appsmith).
-- Source: docs/deploy/APPSMITH_AISHA_OPS.md (Phase 4 of AUTONOMOUS_DEPLOY_FLOW.md)

CREATE TABLE IF NOT EXISTS public.dashboard_render_history (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  rendered_at     timestamptz  NOT NULL DEFAULT now(),
  dashboard_slug  text         NOT NULL DEFAULT 'aisha-ops',
  content_hash    text         NOT NULL,                -- SHA-256 of rendered JSON
  triggered_by    text         NOT NULL CHECK (triggered_by IN (
                    'cron_30min', 'manual_webhook', 'first_bootstrap', 'force_rebuild'
                  )),
  diff_summary    jsonb,                                 -- which sections changed since prev
  appsmith_app_id text,                                  -- after import, populated
  publish_status  text         NOT NULL DEFAULT 'pending'
                  CHECK (publish_status IN ('pending', 'published', 'skipped_no_change', 'failed')),
  publish_error   text,                                  -- if failed
  duration_ms     int,
  metadata        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dashboard_render_history IS
  'Audit + idempotency log dashboard renderingem WF_APPSMITH_DASHBOARD_BUILDER.  Content hash umožňuje skip-if-unchanged (žádný zbytečný API call do Appsmith).';

ALTER TABLE public.dashboard_render_history ENABLE ROW LEVEL SECURITY;

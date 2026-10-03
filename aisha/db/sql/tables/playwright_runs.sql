-- Table: playwright_runs
-- One row per Playwright invocation against a deployed environment.
-- The runner (svc-playwright-runner container) marks rows running →
-- passed|failed|errored; aborted is operator-side. HTML/JSON reports
-- live in storage bucket `e2e-reports/<run_id>/`.

CREATE TABLE IF NOT EXISTS public.playwright_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  trigger_kind public.playwright_run_trigger NOT NULL,
  target_env text NOT NULL,                -- e.g. 'staging', 'production', 'tenant-staging'
  target_base_url text NOT NULL,           -- e.g. 'https://stage.aisha.guru'
  suite text NOT NULL DEFAULT 'all',       -- spec glob OR 'all'
  deploy_ref text,                         -- commit/tag of the deployed build
  status public.playwright_run_status NOT NULL DEFAULT 'queued',
  total integer,
  passed integer,
  failed integer,
  skipped integer,
  duration_ms integer,
  report_storage_path text,                -- 'e2e-reports/<run_id>/index.html'
  trace_json_path text,                    -- 'e2e-reports/<run_id>/results.json'
  error_message text,
  requested_by uuid REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  approval_required boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Production integration (migration 20260518040000):
  app_name text,                                                              -- coolify_app_slots.app_name; when set, B/G slot health is updated post-run
  active_slot text CHECK (active_slot IN ('blue', 'green')),                  -- captured at start so a mid-run switch can't misroute rollback
  story_id uuid REFERENCES public.partner_stories(id) ON DELETE SET NULL,     -- when set, lifecycle emits qa_playwright_* story_entries
  triggered_rollback_id uuid REFERENCES public.rollback_history(id) ON DELETE SET NULL, -- linked when staging_auto failure auto-requests rollback
  PRIMARY KEY (id)
);

ALTER TABLE public.playwright_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.playwright_runs IS 'Playwright E2E runs against deployed environments (staging auto, production manual). Story-linked runs emit qa_playwright_* entries; app-linked runs feed back into coolify_app_slots health + Sentry rollback path.';
COMMENT ON COLUMN public.playwright_runs.approval_required IS 'TRUE for production_manual — runner waits until approved_at is set.';
COMMENT ON COLUMN public.playwright_runs.metadata IS 'browser, viewport, parallel workers, env hints, etc.';
COMMENT ON COLUMN public.playwright_runs.app_name IS 'coolify_app_slots.app_name — when set, target_base_url is derived from the live slot and the result updates {active_slot}_health.';
COMMENT ON COLUMN public.playwright_runs.active_slot IS 'Captured at start time so a slot switch mid-run does not confuse rollback wiring.';
COMMENT ON COLUMN public.playwright_runs.story_id IS 'When set, the run lifecycle emits story_entries (qa_playwright_*) mirroring the web_artifact pattern.';
COMMENT ON COLUMN public.playwright_runs.triggered_rollback_id IS 'When a staging_auto run fails and the Sentry observer requests a rollback, that rollback_history row is linked here.';

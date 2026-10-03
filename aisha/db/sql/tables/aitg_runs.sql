-- ============================================================================
-- Table: aitg_runs
-- Purpose: One row per executed AITG test (build-bound or sentinel-triggered).
-- Append-only via aitg_record_run_audited RPC.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.aitg_runs (
  run_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id       text NOT NULL REFERENCES public.aitg_test_catalog(test_id),
  build_sha     text NOT NULL,
  triggered_by  text NOT NULL CHECK (triggered_by IN ('pr-gate','nightly','manual','sentinel','self')),
  status        aitg_status NOT NULL,
  severity      aitg_severity NOT NULL DEFAULT 'info',
  evidence_uri  text,
  ai_run_id     uuid REFERENCES public.ai_runs(id),
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

ALTER TABLE public.aitg_runs ENABLE ROW LEVEL SECURITY;

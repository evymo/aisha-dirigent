-- ============================================================================
-- Table: aitg_findings
-- Purpose: Detailed observation per failed run. 1 run → 0..N findings.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.aitg_findings (
  finding_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid NOT NULL REFERENCES public.aitg_runs(run_id) ON DELETE CASCADE,
  payload_id       uuid REFERENCES public.aitg_payloads(payload_id),
  severity         aitg_severity NOT NULL,
  observed         jsonb NOT NULL,
  classifier_score numeric CHECK (classifier_score IS NULL OR classifier_score BETWEEN 0 AND 1),
  remediation      text,
  fixed_at         timestamptz
);

ALTER TABLE public.aitg_findings ENABLE ROW LEVEL SECURITY;

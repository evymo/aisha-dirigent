-- Index: idx_aitg_findings_run
-- Extracted from tables/aitg_findings.sql (SQL source separation policy)

CREATE INDEX IF NOT EXISTS idx_aitg_findings_run      ON public.aitg_findings(run_id);

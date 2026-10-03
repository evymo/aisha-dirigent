-- Index: idx_aitg_findings_open
-- Extracted from tables/aitg_findings.sql (SQL source separation policy)

CREATE INDEX IF NOT EXISTS idx_aitg_findings_open     ON public.aitg_findings(fixed_at)
  WHERE fixed_at IS NULL;

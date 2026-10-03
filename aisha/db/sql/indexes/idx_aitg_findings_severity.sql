-- Index: idx_aitg_findings_severity
-- Extracted from tables/aitg_findings.sql (SQL source separation policy)

CREATE INDEX IF NOT EXISTS idx_aitg_findings_severity ON public.aitg_findings(severity)
  WHERE severity IN ('high', 'critical');

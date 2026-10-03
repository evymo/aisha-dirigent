-- Index: idx_li_findings_severity
-- Table: li_findings

CREATE INDEX IF NOT EXISTS idx_li_findings_severity ON public.li_findings (severity);

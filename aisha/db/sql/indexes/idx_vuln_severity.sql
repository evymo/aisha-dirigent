-- Index: idx_vuln_severity
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_vuln_severity ON public.project_vulnerabilities(severity);

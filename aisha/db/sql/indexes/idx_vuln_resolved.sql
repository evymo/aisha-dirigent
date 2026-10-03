-- Index: idx_vuln_resolved
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_vuln_resolved ON public.project_vulnerabilities(is_resolved);

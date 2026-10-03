-- Index: idx_vuln_project
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_vuln_project ON public.project_vulnerabilities(project_slug);

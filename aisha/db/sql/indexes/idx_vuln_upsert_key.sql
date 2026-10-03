-- Index: idx_vuln_upsert_key
-- Auto-extracted from table SoT

CREATE UNIQUE INDEX IF NOT EXISTS idx_vuln_upsert_key
  ON public.project_vulnerabilities(project_slug, package_name, title);

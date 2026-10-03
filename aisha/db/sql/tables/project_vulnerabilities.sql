-- Table: public.project_vulnerabilities
-- Aggregated vulnerability findings from npm audit, security scans, etc.

CREATE TABLE IF NOT EXISTS public.project_vulnerabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_slug TEXT NOT NULL,
  package_name TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'moderate', 'low', 'info')),
  title TEXT NOT NULL,
  description TEXT,
  fixed_in TEXT,
  url TEXT,
  source TEXT NOT NULL DEFAULT 'npm_audit',
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_vulnerabilities ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.project_vulnerabilities IS
  'Aggregated vulnerability findings for project monitoring.';

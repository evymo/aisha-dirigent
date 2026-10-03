-- Policy: project_vulnerabilities_read
-- Table: project_vulnerabilities

DROP POLICY IF EXISTS project_vulnerabilities_read ON public.project_vulnerabilities;
CREATE POLICY project_vulnerabilities_read ON public.project_vulnerabilities
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));

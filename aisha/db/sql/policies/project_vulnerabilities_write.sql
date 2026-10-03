-- Policy: project_vulnerabilities_write
-- Table: project_vulnerabilities

DROP POLICY IF EXISTS project_vulnerabilities_write ON public.project_vulnerabilities;
CREATE POLICY project_vulnerabilities_write ON public.project_vulnerabilities
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin_or_staff()))
  WITH CHECK ((SELECT public.is_admin_or_staff()));

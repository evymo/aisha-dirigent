DROP POLICY IF EXISTS aitg_findings_read_admin ON public.aitg_findings;
CREATE POLICY aitg_findings_read_admin ON public.aitg_findings
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));

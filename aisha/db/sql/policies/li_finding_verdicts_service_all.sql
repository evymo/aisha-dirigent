-- Policy: service_role smí vše (back-office / automatizace), jako u li_findings.
-- Source of truth pair: aisha/db/sql/tables/li_finding_verdicts.sql

DROP POLICY IF EXISTS li_finding_verdicts_service_all ON public.li_finding_verdicts;
CREATE POLICY li_finding_verdicts_service_all ON public.li_finding_verdicts
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

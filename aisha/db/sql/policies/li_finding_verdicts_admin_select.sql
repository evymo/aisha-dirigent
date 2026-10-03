-- Policy: čtení verdiktů jen admin/staff — týž okruh, který vidí nálezy samotné
-- (li_findings_admin_select). Čtecí blok get_finding_questions je INVOKER, takže
-- bez téhle policy by každý dotaz vypadal jako nezodpovězený.
-- Source of truth pair: aisha/db/sql/tables/li_finding_verdicts.sql

DROP POLICY IF EXISTS li_finding_verdicts_admin_select ON public.li_finding_verdicts;
CREATE POLICY li_finding_verdicts_admin_select ON public.li_finding_verdicts
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));

-- ============================================================================
-- RLS: aitg_runs — audit metadata is admin/staff-visible. Writes only via
-- aitg_record_run_audited RPC (SECURITY DEFINER); direct INSERT is blocked.
-- ============================================================================

DROP POLICY IF EXISTS aitg_runs_read_admin ON public.aitg_runs;
CREATE POLICY aitg_runs_read_admin ON public.aitg_runs
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));

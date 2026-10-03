-- ============================================================================
-- RLS: aitg_automation_settings — admin/staff readable, write via RPC.
-- Direct UPDATE/INSERT/DELETE is denied; the audited RPCs are the only
-- mutation path so every change lands in audit_journal.
-- ============================================================================

DROP POLICY IF EXISTS aitg_automation_settings_read_admin ON public.aitg_automation_settings;
CREATE POLICY aitg_automation_settings_read_admin ON public.aitg_automation_settings
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));

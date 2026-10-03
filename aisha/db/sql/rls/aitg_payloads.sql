-- ============================================================================
-- RLS: aitg_payloads — adversarial corpus is sensitive (a curated jailbreak
-- list). Only admin/staff may read via RPC; direct table reads are blocked
-- for everyone except service_role.
-- ============================================================================

DROP POLICY IF EXISTS aitg_payloads_read_admin ON public.aitg_payloads;
CREATE POLICY aitg_payloads_read_admin ON public.aitg_payloads
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));

DROP POLICY IF EXISTS aitg_payloads_write_admin ON public.aitg_payloads;
CREATE POLICY aitg_payloads_write_admin ON public.aitg_payloads
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin_or_staff()))
  WITH CHECK ((SELECT public.is_admin_or_staff()));

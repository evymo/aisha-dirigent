-- ============================================================================
-- RLS: llm_quota + llm_tier_defaults
-- Phase 12 WP 2.3 — LLM token rate limit per JWT.sub
--
-- Threat model:
--   - Public must NOT read others' consumption (PII signal — usage patterns)
--   - User reads OWN row only (for in-app "remaining today" display)
--   - Admin/staff reads ALL rows (for ops dashboards)
--   - Mutation: service_role only (the audited RPC owns all writes)
--   - llm_tier_defaults: public read (UI shows tier comparison), admin write
-- ============================================================================

-- ===== llm_quota =====
DROP POLICY IF EXISTS user_read_own_quota ON public.llm_quota;
CREATE POLICY user_read_own_quota
  ON public.llm_quota
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS admin_read_all_quota ON public.llm_quota;
CREATE POLICY admin_read_all_quota
  ON public.llm_quota
  FOR SELECT
  TO authenticated
  USING (public.get_jwt_role() IN ('admin', 'staff', 'service_role'));

DROP POLICY IF EXISTS service_role_write_quota ON public.llm_quota;
CREATE POLICY service_role_write_quota
  ON public.llm_quota
  FOR ALL
  TO authenticated
  USING (public.get_jwt_role() = 'service_role')
  WITH CHECK (public.get_jwt_role() = 'service_role');

-- ===== llm_tier_defaults =====
DROP POLICY IF EXISTS public_read_tiers ON public.llm_tier_defaults;
CREATE POLICY public_read_tiers
  ON public.llm_tier_defaults
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS admin_write_tiers ON public.llm_tier_defaults;
CREATE POLICY admin_write_tiers
  ON public.llm_tier_defaults
  FOR ALL
  TO authenticated
  USING (public.get_jwt_role() IN ('admin', 'service_role'))
  WITH CHECK (public.get_jwt_role() IN ('admin', 'service_role'));

-- ============================================================================
-- Grants: llm_quota + llm_tier_defaults
-- Phase 12 WP 2.3 — LLM token rate limit per JWT.sub
--
-- Per CLAUDE.md SECURITY DEFINER pattern: REVOKE ALL FROM PUBLIC before any
-- GRANT. Authenticated reads via RLS (own row OR admin); writes only via the
-- audited RPC (which is service-role).
-- ============================================================================

-- ===== llm_quota =====
REVOKE ALL ON TABLE public.llm_quota FROM PUBLIC;
GRANT SELECT ON TABLE public.llm_quota TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.llm_quota TO authenticated;
-- Note: RLS service_role_write_quota gates the INSERT/UPDATE/DELETE rights
-- to actual service-role JWTs; authenticated users can't mutate their own
-- quota row even if they hold the grant.

-- ===== llm_tier_defaults =====
REVOKE ALL ON TABLE public.llm_tier_defaults FROM PUBLIC;
GRANT SELECT ON TABLE public.llm_tier_defaults TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.llm_tier_defaults TO authenticated;
-- RLS admin_write_tiers gates writes to admin/service_role only.

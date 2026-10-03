-- ============================================================================
-- Grants: ai_budget
-- Mission Control governance — scope-generic AI spend cap.
--
-- Per CLAUDE.md SECURITY DEFINER pattern: REVOKE ALL FROM PUBLIC before any
-- GRANT. Authenticated reads via RLS (admin OR own-story participant); writes
-- only via the audited RPCs (which run SECURITY DEFINER as service-role).
-- ============================================================================

REVOKE ALL ON TABLE public.ai_budget FROM PUBLIC;
GRANT SELECT ON TABLE public.ai_budget TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.ai_budget TO authenticated;
-- Note: RLS service_role_write_budget gates the INSERT/UPDATE/DELETE rights to
-- actual service-role JWTs; authenticated users can't mutate a budget row even
-- if they hold the grant.

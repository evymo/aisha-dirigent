-- Function: audience_compute_actor_tier (Brick6 — UNGUARDED tier source of truth)
--
-- The pure tier label for a user (anonymous / registered / active / qualified / partner)
-- WITHOUT the audience_user_can_see_creator_stats privacy guard. A tier label gates content
-- but exposes no stats, so this is the single source of truth shared by:
--   - audience_derive_actor_tier(uuid)            — wraps this WITH the privacy guard (the
--                                                    public, stats-exposing path);
--   - audience_user_meets_tier_requirement(text, uuid) — the tier-ACL boolean gate (trusted
--                                                    internal callers that already pinned the
--                                                    actor, e.g. mcp_search_knowledge_v3).
-- service_role only — never call this where a privacy guard is required; use the guarded
-- audience_derive_actor_tier for that. A NULL p_user_id yields 'anonymous'.
CREATE OR REPLACE FUNCTION public.audience_compute_actor_tier(p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN p.user_id IS NULL THEN 'anonymous'
      WHEN pp.is_visible AND pp.is_production_provider THEN 'partner'
      WHEN pp.is_certified THEN 'qualified'
      WHEN COALESCE(ea.app_accesses_30d, 0) > 0 THEN 'active'
      ELSE 'registered'
    END
  FROM (SELECT p_user_id AS user_id) ids
  LEFT JOIN public.profiles p ON p.user_id = ids.user_id
  LEFT JOIN public.partner_profiles pp ON pp.user_id = ids.user_id
  LEFT JOIN public.audience_actor_aggregate_latest_v ea ON ea.user_id = ids.user_id;
$function$;

REVOKE ALL ON FUNCTION audience_compute_actor_tier(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_compute_actor_tier(uuid) TO service_role;

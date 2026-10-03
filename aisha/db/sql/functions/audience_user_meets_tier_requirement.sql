-- Function: audience_user_meets_tier_requirement
--
-- 1-arg: does the CURRENT caller (auth.uid(), or 'admin' if staff) meet p_required_tier?
-- 2-arg (Brick6 tier-ACL): does a SPECIFIC user meet it? Used by mcp_search_knowledge_v2/v3
--   to gate knowledge by minimum_tier. Properties:
--     * FAIL CLOSED — a NULL/unknown user is 'anonymous' (the lowest tier);
--     * uses the UNGUARDED audience_compute_actor_tier (a boolean gate exposes no stats, so the
--       privacy guard would only get in the way of a service-role tier check);
--     * admin/staff users meet every tier;
--     * spoof-safety is the caller's responsibility — v2/v3 only let service_role pass an
--       arbitrary p_user_id; authenticated callers are pinned to auth.uid().

CREATE OR REPLACE FUNCTION public.audience_user_meets_tier_requirement(p_required_tier text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH tier_rank AS (
    SELECT * FROM (VALUES
      ('anonymous', 0), ('registered', 1), ('active', 2),
      ('qualified', 3), ('partner', 4), ('admin', 5)
    ) AS t(name, rank)
  )
  SELECT caller.rank >= required.rank
  FROM tier_rank required, tier_rank caller
  WHERE required.name = p_required_tier
    AND caller.name = CASE
      WHEN is_admin_or_staff() THEN 'admin'
      ELSE public.audience_derive_actor_tier(auth.uid())
    END;
$function$;

CREATE OR REPLACE FUNCTION public.audience_user_meets_tier_requirement(p_required_tier text, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tier text;
BEGIN
  IF p_required_tier IS NULL THEN
    RETURN true;  -- ungated knowledge: everyone qualifies
  END IF;
  -- FAIL CLOSED: NULL/unknown user => 'anonymous'. is_admin_or_staff(p_user_id) so an
  -- admin/staff actor meets every tier (audience_compute_actor_tier itself never returns 'admin').
  v_tier := CASE
    WHEN p_user_id IS NOT NULL AND public.is_admin_or_staff(p_user_id) THEN 'admin'
    ELSE public.audience_compute_actor_tier(p_user_id)
  END;
  RETURN (
    WITH tier_rank AS (
      SELECT * FROM (VALUES
        ('anonymous', 0), ('registered', 1), ('active', 2),
        ('qualified', 3), ('partner', 4), ('admin', 5)
      ) AS t(name, rank)
    )
    SELECT caller.rank >= required.rank
    FROM tier_rank required, tier_rank caller
    WHERE required.name = p_required_tier AND caller.name = v_tier
  );
END;
$function$;

REVOKE ALL ON FUNCTION audience_user_meets_tier_requirement(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_user_meets_tier_requirement(text) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_user_meets_tier_requirement(text) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_user_meets_tier_requirement(text) TO service_role;
REVOKE ALL ON FUNCTION audience_user_meets_tier_requirement(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_user_meets_tier_requirement(text, uuid) TO service_role;

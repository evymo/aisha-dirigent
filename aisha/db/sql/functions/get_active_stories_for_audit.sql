-- Function: get_active_stories_for_audit

CREATE OR REPLACE FUNCTION public.get_active_stories_for_audit()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- Admin or service role only
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      ps.id,
      ps.title,
      ps.delivery_status,
      ps.tech_stack,
      ps.domain,
      ps.risk_profile,
      ps.repo_url,
      sr.ruleset_fingerprint,
      sr.created_at AS ruleset_created_at,
      CASE
        WHEN sr.id IS NULL THEN 'no_ruleset'
        WHEN sr.created_at < now() - interval '7 days' THEN 'stale_ruleset'
        ELSE 'ok'
      END AS ruleset_health
    FROM partner_stories ps
    LEFT JOIN story_contexts sc ON sc.story_id = ps.id
    LEFT JOIN story_rulesets sr ON sr.id = sc.ruleset_id
    WHERE ps.delivery_status IN ('in_progress', 'qa', 'review')
      AND ps.status = 'active'
    ORDER BY
      CASE ps.risk_profile
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        ELSE 3
      END,
      ps.updated_at DESC
  ) t;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION get_active_stories_for_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_active_stories_for_audit() TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_stories_for_audit() TO service_role;

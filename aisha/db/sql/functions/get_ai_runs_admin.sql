-- Function: public.get_ai_runs_admin
-- Arguments: p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_status text DEFAULT NULL::text
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_ai_runs_admin(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_status text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, kind text, status text, story_id uuid, actor_user_id uuid, route_plan jsonb, cost_total_json jsonb, metadata jsonb, started_at timestamptz, finished_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = 'P0003';
  END IF;

  RETURN QUERY
  SELECT
    ar.id, ar.kind, ar.status::text,
    ar.story_id, ar.actor_user_id,
    ar.route_plan, ar.cost_total_json, ar.metadata,
    ar.started_at, ar.finished_at
  FROM ai_runs ar
  WHERE (p_status IS NULL OR ar.status::text = p_status)
  ORDER BY ar.started_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_ai_runs_admin(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ai_runs_admin(integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_runs_admin(integer, integer, text) TO service_role;

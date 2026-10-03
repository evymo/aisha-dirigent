CREATE OR REPLACE FUNCTION public.fn_aggregate_personality_signals(
  p_user_id uuid,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Auth: ensure caller is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Authz: reject cross-user access (service_role / admin may target another user)
  IF p_user_id <> auth.uid()
     AND NOT public.is_service_role()
     AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(sub.obj ORDER BY sub.signal_count DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      jsonb_build_object(
        'signal_type', ps.signal_type,
        'signal_count', count(*),
        'avg_weight', round(avg(ps.weight)::numeric, 3),
        'max_weight', round(max(ps.weight)::numeric, 3),
        'first_seen', min(ps.created_at),
        'last_seen', max(ps.created_at),
        'trend', CASE
          WHEN avg(CASE WHEN ps.created_at > now() - (p_days / 2 || ' days')::interval THEN ps.weight END)
             > avg(CASE WHEN ps.created_at <= now() - (p_days / 2 || ' days')::interval THEN ps.weight END)
          THEN 'increasing'
          WHEN avg(CASE WHEN ps.created_at > now() - (p_days / 2 || ' days')::interval THEN ps.weight END)
             < avg(CASE WHEN ps.created_at <= now() - (p_days / 2 || ' days')::interval THEN ps.weight END)
          THEN 'decreasing'
          ELSE 'stable'
        END
      ) AS obj,
      count(*) AS signal_count
    FROM personality_signals ps
    WHERE ps.user_id = p_user_id
      AND ps.created_at > now() - (p_days || ' days')::interval
    GROUP BY ps.signal_type
    HAVING count(*) >= 3  -- minimum signal threshold for relevance
  ) sub;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_aggregate_personality_signals(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_aggregate_personality_signals(uuid, integer) TO authenticated;

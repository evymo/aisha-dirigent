-- Function: audience_admin_get_funnel_metrics

CREATE OR REPLACE FUNCTION public.audience_admin_get_funnel_metrics(p_date_from timestamp with time zone DEFAULT (now() - '90 days'::interval), p_date_to timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', p_date_from, 'to', p_date_to),
    'tiers', (
      SELECT jsonb_object_agg(member_tier, jsonb_build_object(
        'count', actor_count,
        'active_30d', active_30d,
        'with_audience', with_audience,
        'avg_audience', avg_audience_size
      ))
      FROM public.audience_admin_tier_funnel_v
    ),
    'new_registrations', (
      SELECT COUNT(*)
      FROM public.profiles
      WHERE created_at BETWEEN p_date_from AND p_date_to
    ),
    'campaigns_sent', (
      SELECT COUNT(DISTINCT campaign_id)
      FROM public.openclaw_notifications
      WHERE created_at BETWEEN p_date_from AND p_date_to
        AND campaign_id IS NOT NULL
    ),
    'unique_reached', (
      SELECT COUNT(DISTINCT user_id)
      FROM public.openclaw_notifications
      WHERE created_at BETWEEN p_date_from AND p_date_to
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_admin_get_funnel_metrics(timestamp with time zone,timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_admin_get_funnel_metrics(timestamp with time zone,timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_admin_get_funnel_metrics(timestamp with time zone,timestamp with time zone) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_admin_get_funnel_metrics(timestamp with time zone,timestamp with time zone) TO service_role;

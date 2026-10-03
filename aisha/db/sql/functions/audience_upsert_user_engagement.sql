-- Function: audience_upsert_user_engagement

CREATE OR REPLACE FUNCTION public.audience_upsert_user_engagement(p_user_id uuid, p_data jsonb, p_source_slug text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.user_engagement_metrics (
    user_id,
    app_accesses_30d, app_accesses_90d, last_active_at,
    events_created_30d, events_created_90d, posts_created_30d,
    audience_size, audience_growth_30d, unique_attendees_30d, total_attendance_30d,
    emails_opened_90d, emails_sent_90d, email_open_rate_90d, email_click_rate_90d,
    source_slug, computed_at, updated_at
  ) VALUES (
    p_user_id,
    COALESCE((p_data->>'app_accesses_30d')::int, 0),
    COALESCE((p_data->>'app_accesses_90d')::int, 0),
    NULLIF(p_data->>'last_active_at', '')::timestamptz,
    COALESCE((p_data->>'events_created_30d')::int, 0),
    COALESCE((p_data->>'events_created_90d')::int, 0),
    COALESCE((p_data->>'posts_created_30d')::int, 0),
    COALESCE((p_data->>'audience_size')::int, 0),
    COALESCE((p_data->>'audience_growth_30d')::numeric, 0),
    COALESCE((p_data->>'unique_attendees_30d')::int, 0),
    COALESCE((p_data->>'total_attendance_30d')::int, 0),
    COALESCE((p_data->>'emails_opened_90d')::int, 0),
    COALESCE((p_data->>'emails_sent_90d')::int, 0),
    NULLIF(p_data->>'email_open_rate_90d', '')::numeric,
    NULLIF(p_data->>'email_click_rate_90d', '')::numeric,
    p_source_slug, now(), now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    app_accesses_30d = EXCLUDED.app_accesses_30d,
    app_accesses_90d = EXCLUDED.app_accesses_90d,
    last_active_at = EXCLUDED.last_active_at,
    events_created_30d = EXCLUDED.events_created_30d,
    events_created_90d = EXCLUDED.events_created_90d,
    posts_created_30d = EXCLUDED.posts_created_30d,
    audience_size = EXCLUDED.audience_size,
    audience_growth_30d = EXCLUDED.audience_growth_30d,
    unique_attendees_30d = EXCLUDED.unique_attendees_30d,
    total_attendance_30d = EXCLUDED.total_attendance_30d,
    emails_opened_90d = EXCLUDED.emails_opened_90d,
    emails_sent_90d = EXCLUDED.emails_sent_90d,
    email_open_rate_90d = EXCLUDED.email_open_rate_90d,
    email_click_rate_90d = EXCLUDED.email_click_rate_90d,
    source_slug = EXCLUDED.source_slug,
    computed_at = now(),
    updated_at = now();
END;
$function$

;

REVOKE ALL ON FUNCTION audience_upsert_user_engagement(uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_upsert_user_engagement(uuid,jsonb,text) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_upsert_user_engagement(uuid,jsonb,text) TO service_role;

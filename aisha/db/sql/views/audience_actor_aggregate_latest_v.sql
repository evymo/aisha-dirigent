-- View: public.audience_actor_aggregate_latest_v
-- Latest engagement aggregate per actor (passthrough projection of user_engagement_metrics).

CREATE OR REPLACE VIEW public.audience_actor_aggregate_latest_v AS
 SELECT user_id,
    app_accesses_30d,
    app_accesses_90d,
    last_active_at,
    events_created_30d,
    events_created_90d,
    posts_created_30d,
    audience_size,
    audience_growth_30d,
    unique_attendees_30d,
    total_attendance_30d,
    emails_opened_90d,
    emails_sent_90d,
    email_open_rate_90d,
    email_click_rate_90d,
    source_slug,
    computed_at,
    updated_at AS last_calculated_at
   FROM user_engagement_metrics;

COMMENT ON VIEW public.audience_actor_aggregate_latest_v IS
  'Latest engagement aggregate per actor. Renamed source_connector_slug
         → source_slug in migration 20260524100000 (via ALTER VIEW RENAME
         COLUMN — preserves the dependent view subtree, no DROP CASCADE).';

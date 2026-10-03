-- View: public.audience_creator_audience_v
-- Aggregated audience metrics per creator (partner with audience > 0).

CREATE OR REPLACE VIEW public.audience_creator_audience_v AS
 SELECT ea.user_id AS creator_user_id,
    p.display_name AS creator_name,
    p.email AS creator_email,
    pp.business_name AS creator_business,
    pp.services AS creator_specializations,
    ea.audience_size,
    ea.audience_growth_30d,
    ea.unique_attendees_30d,
    ea.total_attendance_30d,
    ea.events_created_30d,
    ea.events_created_90d,
    ea.last_active_at,
    ea.computed_at
   FROM audience_actor_aggregate_latest_v ea
     JOIN profiles p ON p.user_id = ea.user_id
     LEFT JOIN partner_profiles pp ON pp.user_id = ea.user_id
  WHERE ea.audience_size > 0 AND (pp.is_visible IS NULL OR pp.is_visible = true);

COMMENT ON VIEW public.audience_creator_audience_v IS
  'Aggregated audience metrics per creator (partner with audience > 0).
   Drives admin dashboards and "My Audience" portal tab. No raw data.';

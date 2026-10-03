-- View: public.audience_my_audience_v
-- Self-scoped audience view (caller sees only own audience metrics).

CREATE OR REPLACE VIEW public.audience_my_audience_v AS
 SELECT creator_user_id,
    creator_name,
    creator_business,
    creator_specializations,
    audience_size,
    audience_growth_30d,
    unique_attendees_30d,
    total_attendance_30d,
    events_created_30d,
    events_created_90d,
    last_active_at,
    computed_at
   FROM audience_creator_audience_v
  WHERE creator_user_id = auth.uid();

COMMENT ON VIEW public.audience_my_audience_v IS
  'Self-scoped audience view. Caller (must be partner tier) sees only own
   audience metrics. Powers MemberPortal "My Audience" tab.';

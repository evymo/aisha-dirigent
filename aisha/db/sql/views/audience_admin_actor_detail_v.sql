-- View: public.audience_admin_actor_detail_v
-- Composite actor detail (profile + tier + overlay + engagement + roles + cohorts).

CREATE OR REPLACE VIEW public.audience_admin_actor_detail_v AS
 SELECT p.user_id,
    p.display_name,
    p.email,
    p.phone,
    p.date_of_birth,
    p.preferred_language,
    p.created_at AS profile_created_at,
    tier.member_tier,
    tier.business_name,
    tier.specializations,
    tier.certification_level,
    tier.certification_passed_at,
    ovl.notes,
    ovl.pending_followups,
    ovl.tags,
    ovl.assigned_to_partner_id,
    agg.audience_size,
    agg.audience_growth_30d,
    agg.unique_attendees_30d,
    agg.total_attendance_30d,
    agg.events_created_30d,
    agg.events_created_90d,
    agg.app_accesses_30d,
    agg.app_accesses_90d,
    agg.last_active_at,
    agg.email_open_rate_90d,
    agg.email_click_rate_90d,
    ( SELECT jsonb_agg(jsonb_build_object('role', sc.role, 'scope_type', sc.scope_type, 'scope_id', sc.study_id, 'status', sc.status, 'approved_at', sc.approved_at)) AS jsonb_agg
           FROM study_consultants sc
          WHERE sc.partner_id = p.user_id AND sc.status = 'approved'::consultant_status_enum) AS active_roles,
    ( SELECT jsonb_agg(jsonb_build_object('cohort_id', sr.study_id, 'cohort_name', s.name, 'cohort_type', s.study_type, 'status', sr.status, 'enrolled_at', sr.enrolled_at)) AS jsonb_agg
           FROM study_registrations sr
             JOIN studies s ON s.id = sr.study_id
          WHERE sr.user_id = p.user_id AND (sr.status = ANY (ARRAY['active'::text, 'enrolled'::text]))) AS active_cohorts
   FROM profiles p
     LEFT JOIN audience_actor_tier_v tier ON tier.user_id = p.user_id
     LEFT JOIN audience_actor_overlay_v ovl ON ovl.actor_user_id = p.user_id
     LEFT JOIN audience_actor_aggregate_latest_v agg ON agg.user_id = p.user_id;

COMMENT ON VIEW public.audience_admin_actor_detail_v IS
  'Composite detail view: profile + tier + overlay + engagement + roles +
   cohorts. One row per actor. Drives Appsmith "Actor Detail" page.';

-- View: public.audience_admin_cohort_overview_v
-- Cohorts listing with registrations + engagement metrics (studies-backed).

CREATE OR REPLACE VIEW public.audience_admin_cohort_overview_v AS
 SELECT id AS cohort_id,
    name AS cohort_name,
    title,
    study_type AS cohort_type,
    status,
    is_active,
    starts_at,
    ends_at,
    target_registration,
    current_registration,
    ( SELECT avg(ea.audience_size)::integer AS avg
           FROM study_registrations sr
             JOIN audience_actor_aggregate_latest_v ea ON ea.user_id = sr.user_id
          WHERE sr.study_id = s.id AND sr.status = 'active'::text) AS avg_audience_size,
    ( SELECT count(*) AS count
           FROM study_registrations
          WHERE study_registrations.study_id = s.id AND study_registrations.status = 'active'::text) AS active_registrations,
    ( SELECT count(*) AS count
           FROM study_registrations
          WHERE study_registrations.study_id = s.id AND study_registrations.status = 'completed'::text) AS completed_registrations,
    ( SELECT count(DISTINCT ncr.user_id) AS count
           FROM openclaw_notifications ncr
          WHERE (ncr.campaign_id IN ( SELECT notification_campaigns.id
                   FROM notification_campaigns
                  WHERE (notification_campaigns.audience_filter ->> 'cohort_id'::text) = s.id::text)) AND ncr.created_at > (now() - '30 days'::interval)) AS unique_reached_30d,
    created_at,
    updated_at
   FROM studies s
  WHERE is_active = true;

COMMENT ON VIEW public.audience_admin_cohort_overview_v IS
  'Cohorts listing with registrations + engagement metrics. Studies-backed,
   filters out archived. Drives Appsmith "Cohort Manager" template.';

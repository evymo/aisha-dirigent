-- View: public.cohorts
-- CANONICAL cohort view (marketing dialect over studies).

CREATE OR REPLACE VIEW public.cohorts AS
 SELECT id AS cohort_id,
    code AS cohort_code,
    name AS cohort_name,
    title AS display_title,
    slug,
    description,
    study_type AS cohort_type,
    status AS lifecycle_status,
    is_active,
    is_umbrella AS is_program,
    parent_study_id AS parent_cohort_id,
    COALESCE(is_blinded, false) AS is_controlled_experiment,
    target_condition AS qualifying_state,
    target_registration AS audience_target,
    current_registration AS audience_current,
    min_participants AS audience_floor,
    max_participants AS audience_cap,
        CASE
            WHEN COALESCE(target_registration, 0) > 0 THEN round(100.0 * COALESCE(current_registration, 0)::numeric / target_registration::numeric, 1)
            ELSE NULL::numeric
        END AS audience_progress_pct,
    max_participants IS NOT NULL AND COALESCE(current_registration, 0) >= max_participants AS is_at_capacity,
    funding_goal AS budget_target,
    current_funding AS budget_committed,
    funding_deadline AS budget_deadline,
    funding_status AS budget_status,
        CASE
            WHEN COALESCE(funding_goal, 0::numeric) > 0::numeric THEN round(100.0 * COALESCE(current_funding, 0::numeric) / funding_goal, 1)
            ELSE NULL::numeric
        END AS budget_progress_pct,
    starts_at AS campaign_starts_at,
    ends_at AS campaign_ends_at,
    duration_weeks AS campaign_duration_weeks,
        CASE
            WHEN ends_at IS NOT NULL THEN GREATEST(0, EXTRACT(day FROM ends_at - now())::integer)
            ELSE NULL::integer
        END AS days_remaining,
    products AS promoted_offers,
    protocol_url AS playbook_url,
    informed_consent_version AS permission_version,
    informed_consent_special_provisions AS permission_special_provisions,
    invitation_permission AS invitation_policy,
    created_at,
    updated_at
   FROM studies s;

COMMENT ON VIEW public.cohorts IS
  'CANONICAL cohort view (marketing dialect over studies). A cohort IS a
   controlled study: qualifying_state (entry), is_controlled_experiment (A/B),
   permission_version (GDPR consent), budget_* (campaign budget), is_program
   (umbrella). Same storage as clinical studies. audience_cohort_marketing_v
   is a passthrough of this. See docs/audience/MARKETER_GUIDE.md.';

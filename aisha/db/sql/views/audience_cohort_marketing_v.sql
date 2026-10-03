-- View: public.audience_cohort_marketing_v
-- Passthrough alias of public.cohorts (PostgREST audience grant convention).

CREATE OR REPLACE VIEW public.audience_cohort_marketing_v AS
 SELECT cohort_id,
    cohort_code,
    cohort_name,
    display_title,
    slug,
    description,
    cohort_type,
    lifecycle_status,
    is_active,
    is_program,
    parent_cohort_id,
    is_controlled_experiment,
    qualifying_state,
    audience_target,
    audience_current,
    audience_floor,
    audience_cap,
    audience_progress_pct,
    is_at_capacity,
    budget_target,
    budget_committed,
    budget_deadline,
    budget_status,
    budget_progress_pct,
    campaign_starts_at,
    campaign_ends_at,
    campaign_duration_weeks,
    days_remaining,
    promoted_offers,
    playbook_url,
    permission_version,
    permission_special_provisions,
    invitation_policy,
    created_at,
    updated_at
   FROM cohorts;

COMMENT ON VIEW public.audience_cohort_marketing_v IS
  'Passthrough alias of public.cohorts (PostgREST audience%% grant convention).
   Single source of truth is public.cohorts — this can never drift.';

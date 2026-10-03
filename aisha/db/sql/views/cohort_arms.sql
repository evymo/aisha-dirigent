-- View: public.cohort_arms
-- CANONICAL A/B arm membership for cohorts (over study_registrations).

CREATE OR REPLACE VIEW public.cohort_arms AS
 SELECT id AS registration_id,
    study_id AS cohort_id,
    user_id AS actor_id,
    status,
    arm AS experiment_arm,
    COALESCE(is_placebo, false) AS is_holdout,
    group_assignment AS variant,
    enrolled_at,
    completed_at,
    withdrawn_at,
    withdrawal_reason,
    created_at,
    updated_at
   FROM study_registrations r;

COMMENT ON VIEW public.cohort_arms IS
  'CANONICAL A/B arm membership for cohorts. experiment_arm = variant;
   is_holdout = placebo/ghost-ad control (equal-salience placebo so true
   incremental lift is measurable). audience_cohort_arm_v passes through this.';

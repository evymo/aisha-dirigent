-- View: public.audience_cohort_arm_v
-- Passthrough alias of public.cohort_arms.

CREATE OR REPLACE VIEW public.audience_cohort_arm_v AS
 SELECT registration_id,
    cohort_id,
    actor_id,
    status,
    experiment_arm,
    is_holdout,
    variant,
    enrolled_at,
    completed_at,
    withdrawn_at,
    withdrawal_reason,
    created_at,
    updated_at
   FROM cohort_arms;

COMMENT ON VIEW public.audience_cohort_arm_v IS
  'Passthrough alias of public.cohort_arms. Single source of truth is cohort_arms.';

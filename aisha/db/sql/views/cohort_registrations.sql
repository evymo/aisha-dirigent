-- View: public.cohort_registrations
-- Cohort registrations alias over study_registrations.

CREATE OR REPLACE VIEW public.cohort_registrations AS
 SELECT id,
    study_id AS cohort_id,
    user_id,
    status,
    enrolled_at,
    completed_at,
    dropout_reason,
    arm,
    is_placebo,
    group_assignment,
    baseline_data,
    notes,
    withdrawn_at,
    withdrawal_reason,
    consultant_id,
    created_at,
    updated_at
   FROM study_registrations;

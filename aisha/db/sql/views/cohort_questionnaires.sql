-- View: public.cohort_questionnaires
-- Cohort questionnaires alias over study_questionnaires.

CREATE OR REPLACE VIEW public.cohort_questionnaires AS
 SELECT id,
    study_id,
    questionnaire_type,
    questionnaire_id,
    title_key,
    description_key,
    frequency_type,
    frequency_days,
    starts_after_days,
    ends_after_days,
    is_required,
    is_active,
    display_order,
    token_reward,
    questionnaire_version,
    created_at,
    updated_at
   FROM study_questionnaires;

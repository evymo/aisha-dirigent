-- View: public.cohort_consultants
-- Cohort consultants alias over study_consultants.

CREATE OR REPLACE VIEW public.cohort_consultants AS
 SELECT id,
    study_id AS cohort_id,
    scope_type,
    partner_id AS contact_user_id,
    role,
    status,
    max_participants,
    notes,
    applied_at,
    approved_at,
    approved_by
   FROM study_consultants;

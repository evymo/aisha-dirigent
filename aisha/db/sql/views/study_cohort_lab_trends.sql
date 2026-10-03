-- View: public.study_cohort_lab_trends
-- Description: Monthly aggregated lab results trends per study cohort.
-- Security: Used by get_study_cohort_lab_trends() which enforces compliance Safe Harbor.

CREATE OR REPLACE VIEW public.study_cohort_lab_trends AS
SELECT 
  se.study_id,
  date_trunc('month', lr.test_date::timestamp)::date AS month_start,
  count(DISTINCT lr.user_id) AS participant_count,
  round(avg(lr.crp), 2) AS avg_crp,
  round(avg(lr.vitamin_d), 2) AS avg_vitamin_d,
  round(avg(lr.glucose), 2) AS avg_glucose,
  round(avg(lr.cholesterol_total), 2) AS avg_cholesterol,
  round(avg(lr.hemoglobin), 2) AS avg_hemoglobin,
  count(lr.id) AS lab_count
FROM study_registrations se
JOIN lab_results lr ON lr.study_registration_id = se.id
WHERE lr.test_date >= (CURRENT_DATE - INTERVAL '1 year')
  AND lr.status IN ('completed', 'reviewed')
GROUP BY se.study_id, date_trunc('month', lr.test_date::timestamp)::date
ORDER BY se.study_id, month_start;

-- Security: View is accessed only through get_study_cohort_lab_trends()
-- which enforces compliance Safe Harbor (min 5 participants) and auth checks

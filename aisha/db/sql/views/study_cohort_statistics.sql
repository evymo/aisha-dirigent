-- View: public.study_cohort_statistics
-- Description: Aggregated statistics per study cohort for research analysis.
-- Security: Used by get_study_cohort_statistics() which enforces compliance Safe Harbor.

CREATE OR REPLACE VIEW public.study_cohort_statistics AS
SELECT 
  se.study_id,
  count(DISTINCT se.user_id) AS total_participants,
  count(DISTINCT CASE WHEN se.status = 'active' THEN se.user_id END) AS active_participants,
  count(DISTINCT CASE WHEN se.status = 'completed' THEN se.user_id END) AS completed_participants,
  round(avg(hci.pain_level), 1) AS avg_pain_level,
  round(avg(hci.energy_level), 1) AS avg_energy_level,
  round(avg(hci.mood_level), 1) AS avg_mood_level,
  round(avg(hci.sleep_quality), 1) AS avg_sleep_quality,
  round(avg(hci.sleep_hours), 1) AS avg_sleep_hours,
  round(avg(lr.crp), 2) AS avg_crp,
  round(avg(lr.vitamin_d), 1) AS avg_vitamin_d,
  round(avg(lr.glucose), 1) AS avg_glucose,
  count(DISTINCT hci.id) AS total_check_ins,
  count(DISTINCT lr.id) AS total_lab_results,
  count(DISTINCT dl.id) AS total_dosing_logs
FROM study_registrations se
LEFT JOIN health_check_ins hci ON hci.user_id = se.user_id
LEFT JOIN lab_results lr ON lr.user_id = se.user_id
LEFT JOIN dosing_logs dl ON dl.user_id = se.user_id
WHERE se.status IN ('enrolled', 'active', 'completed')
GROUP BY se.study_id;

-- Security: View is accessed only through get_study_cohort_statistics() 
-- which enforces compliance Safe Harbor (min 5 participants) and auth checks

-- View: public.study_cohort_trends
-- Description: Weekly aggregated health trends per study cohort.
-- Security: Used by get_study_cohort_trends() which enforces compliance Safe Harbor.

CREATE OR REPLACE VIEW public.study_cohort_trends AS
SELECT 
  se.study_id,
  date_trunc('week', hc.check_in_date::timestamp)::date AS week_start,
  count(DISTINCT hc.user_id) AS participant_count,
  round(avg(hc.pain_level), 2) AS avg_pain,
  round(avg(hc.energy_level), 2) AS avg_energy,
  round(avg(hc.mood_level), 2) AS avg_mood,
  round(avg(hc.sleep_quality), 2) AS avg_sleep_quality,
  round(avg(hc.sleep_hours), 2) AS avg_sleep_hours,
  count(hc.id) AS check_in_count
FROM study_registrations se
JOIN health_check_ins hc ON hc.study_registration_id = se.id
WHERE hc.check_in_date >= (CURRENT_DATE - INTERVAL '84 days')
GROUP BY se.study_id, date_trunc('week', hc.check_in_date::timestamp)::date
ORDER BY se.study_id, week_start;

-- Security: View is accessed only through get_study_cohort_trends()
-- which enforces compliance Safe Harbor (min 5 participants) and auth checks

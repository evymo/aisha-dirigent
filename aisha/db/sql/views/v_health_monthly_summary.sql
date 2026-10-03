-- View: public.v_health_monthly_summary
-- Description: Monthly health metrics summary per user.

CREATE OR REPLACE VIEW public.v_health_monthly_summary AS
SELECT
  user_id,
  date_trunc('month', check_in_date)::date AS month_start,
  AVG(energy_level)::numeric AS avg_energy,
  AVG(heart_rate_avg)::numeric AS avg_heart_rate,
  AVG(mood_level)::numeric AS avg_mood,
  AVG(pain_level)::numeric AS avg_pain,
  AVG(sleep_hours)::numeric AS avg_sleep_hours,
  AVG(steps_count)::numeric AS avg_steps,
  COUNT(*)::int4 AS days_tracked,
  MAX(heart_rate_max)::int4 AS max_heart_rate,
  MIN(heart_rate_min)::int4 AS min_heart_rate,
  SUM(active_energy_burned)::numeric AS total_calories,
  SUM(distance_meters)::numeric AS total_distance_m
FROM health_check_ins
GROUP BY user_id, date_trunc('month', check_in_date)::date;

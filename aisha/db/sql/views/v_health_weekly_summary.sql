-- View: public.v_health_weekly_summary
-- Description: Weekly health metrics summary per user.
--
-- ⛔ security_invoker JE POVINNÝ (nález 2026-10-04). Bez něj se pohled čte
-- právy VLASTNÍKA, tedy MIMO RLS tabulky health_check_ins — a s GRANT SELECT
-- pro anon/authenticated vydával zdravotní souhrny (tep, bolest, nálada,
-- spánek) VŠECH uživatelů komukoli, i bez účtu. S security_invoker platí
-- policies podkladu: člen vidí své, konzultant souhlasem sdílené, admin vše.
CREATE OR REPLACE VIEW public.v_health_weekly_summary
WITH (security_invoker = true) AS
SELECT
  user_id,
  date_trunc('week', check_in_date)::date AS week_start,
  AVG(energy_level)::numeric AS avg_energy,
  AVG(heart_rate_avg)::numeric AS avg_heart_rate,
  AVG(mood_level)::numeric AS avg_mood,
  AVG(pain_level)::numeric AS avg_pain,
  AVG(sleep_hours)::numeric AS avg_sleep_hours,
  AVG(sleep_quality)::numeric AS avg_sleep_quality,
  AVG(steps_count)::numeric AS avg_steps,
  COUNT(*)::int4 AS days_tracked,
  SUM(activity_minutes)::numeric AS total_activity_minutes,
  SUM(active_energy_burned)::numeric AS total_calories,
  SUM(distance_meters)::numeric AS total_distance_m
FROM health_check_ins
GROUP BY user_id, date_trunc('week', check_in_date)::date;

-- View: public.v_health_weekly_summary
-- Description: Weekly health metrics summary per user.
--
-- ⛔ security_invoker JE POVINNÝ (nález 2026-10-06, opraveno ve stagingu už 10-04,
-- upstream to nedostal). Bez něj se pohled čte právy VLASTNÍKA, tedy MIMO RLS
-- podkladu health_check_ins, a s GRANT SELECT pro anon vydával souhrny stavu
-- (check-iny snímačů: tep, spánek, aktivita …) KAŽDÉHO vlastníka komukoli, i bez
-- přihlášení — únik mezi nájemci. „Stav“ je obecně stav prostředku se snímači
-- (člověk, stroj, nasazený projekt); izolaci drží RLS podkladu, ne pohled.
-- S security_invoker platí policies podkladu: vlastník vidí své řádky, správa
-- vše, nikdo cizí. Granty: grants/v_health_weekly_summary.sql (anon nic).
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

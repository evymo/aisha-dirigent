-- View: public.v_health_monthly_summary
-- Description: Monthly health metrics summary per user.
--
-- ⛔ security_invoker JE POVINNÝ (nález 2026-10-06, opraveno ve stagingu už 10-04,
-- upstream to nedostal). Bez něj se pohled čte právy VLASTNÍKA, tedy MIMO RLS
-- podkladu health_check_ins, a s GRANT SELECT pro anon vydával souhrny stavu
-- (check-iny snímačů: tep, spánek, aktivita …) KAŽDÉHO vlastníka komukoli, i bez
-- přihlášení — únik mezi nájemci. „Stav“ je obecně stav prostředku se snímači
-- (člověk, stroj, nasazený projekt); izolaci drží RLS podkladu, ne pohled.
-- S security_invoker platí policies podkladu: vlastník vidí své řádky, správa
-- vše, nikdo cizí. Granty: grants/v_health_monthly_summary.sql (anon nic).
CREATE OR REPLACE VIEW public.v_health_monthly_summary
WITH (security_invoker = true) AS
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

-- View: public.audience_admin_source_stats_monthly_v
-- „Vysvětleno v grafu": jeden řádek = (druh, měsíc) s počtem vzniklých položek
-- a součtem sledujících. Nad tímhle stojí grafy; tabulky výše nesou detail.
CREATE OR REPLACE VIEW public.audience_admin_source_stats_monthly_v AS
SELECT
  s.kind,
  s.month,
  count(*)::bigint                                         AS items_count,
  sum(s.follow_count)::bigint                              AS follows_total,
  count(*) FILTER (WHERE s.cancelled OR s.deleted)::bigint AS withdrawn_count,
  count(*) FILTER (WHERE s.official)::bigint               AS official_count,
  count(*) FILTER (WHERE s.online)::bigint                 AS online_count
FROM public.source_period_stats s
GROUP BY s.kind, s.month;
COMMENT ON VIEW public.audience_admin_source_stats_monthly_v IS
  'Per (kind, month) counts over source_period_stats — chart source. Admin/staff.';

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

-- ⛔ Pohled s právy VLASTNÍKA (bez security_invoker) čte podklad MIMO jeho RLS.
-- Čte se JEN přes DEFINER blokové funkce get_audience_view_*_block (stráž
-- is_admin_or_staff + jmenný prostor audience_admin_*_v). Přímý grant klientské
-- roli tu stráž obcházel přes /rest/v1/ (naměřeno na čisté DB main 0f992f647:
-- authenticated SELECT, u followup_queue/twin_directory i DML z default privileges).
-- REVOKE i z anon/authenticated: na běžící DB žijí explicitní granty z dřívějších
-- bloků heals a z ALTER DEFAULT PRIVILEGES při každém DROP+CREATE pohledu.
-- Třídu hlídá src/tests/db/pohled-s-pravy-vlastnika-bez-klientskeho-grantu.runtime.test.ts.
REVOKE ALL ON public.audience_admin_source_stats_monthly_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audience_admin_source_stats_monthly_v TO service_role;

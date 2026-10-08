-- View: public.audience_admin_source_topic_monthly_v
-- Agregát pro GRAF nových témat po měsících. Zvláštní pohled místo filtru
-- v konfiguraci bloku: get_audience_view_chart_block filtry NEUMÍ (ověřeno
-- 2026-09-08), takže filtr `kind` v configu by se tiše ignoroval a graf by
-- smíchal témata s událostmi — zelené nasazení, špatné číslo. Pohled je
-- jediné místo, kde se druh vybírá, a nedá se obejít konfigurací.
CREATE OR REPLACE VIEW public.audience_admin_source_topic_monthly_v AS
SELECT month, items_count, follows_total, withdrawn_count, official_count, online_count
FROM public.audience_admin_source_stats_monthly_v
WHERE kind = 'topic';
COMMENT ON VIEW public.audience_admin_source_topic_monthly_v IS
  'Topics created per month (chart source). Admin/staff.';

-- ⛔ Pohled s právy VLASTNÍKA (bez security_invoker) čte podklad MIMO jeho RLS.
-- Čte se JEN přes DEFINER blokové funkce get_audience_view_*_block (stráž
-- is_admin_or_staff + jmenný prostor audience_admin_*_v). Přímý grant klientské
-- roli tu stráž obcházel přes /rest/v1/ (naměřeno na čisté DB main 0f992f647:
-- authenticated SELECT, u followup_queue/twin_directory i DML z default privileges).
-- REVOKE i z anon/authenticated: na běžící DB žijí explicitní granty z dřívějších
-- bloků heals a z ALTER DEFAULT PRIVILEGES při každém DROP+CREATE pohledu.
-- Třídu hlídá src/tests/db/pohled-s-pravy-vlastnika-bez-klientskeho-grantu.runtime.test.ts.
REVOKE ALL ON public.audience_admin_source_topic_monthly_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audience_admin_source_topic_monthly_v TO service_role;

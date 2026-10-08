-- View: public.audience_admin_activity_monthly_v
-- Aktivita komunity v ČASE — kolik doteků kterého druhu padlo v kterém měsíci.
--
-- ⛔ PROČ NAD `twin_events` A NE NAD STARÝM MODELEM (naměřeno 2026-09-07).
-- Analytická vrstva měřila `profiles`/`openclaw_notifications` — tedy model,
-- jehož funkci mezitím převzala dvojčata. V číslech: starý model nese 15 osob,
-- 0 notifikací a 1 kampaň; nový 370 dvojčat, 1 578 událostí a 1 415 dokladů.
-- Statistiky proto neukazovaly málo dat — ukazovaly SPRÁVNÁ data ŠPATNÉHO
-- modelu, což je horší, protože to vypadá jako prázdná komunita.
--
-- `parameter` se vylučuje JMENOVITĚ, ne výčtem toho, co se ukazuje: nový druh
-- doteku se pak objeví sám, kdežto výčet by ho mlčky spolkl. (Táž volba jako
-- v `audience_admin_twin_timeline_v`.) Parametry nejsou doteky — jsou to
-- hodnoty vlastností dvojčete a na ose aktivity by lhaly.
CREATE OR REPLACE VIEW public.audience_admin_activity_monthly_v AS
 SELECT date_trunc('month', e.occurred_at)::date AS month,
    e.event_type,
    count(*) AS event_count,
    count(DISTINCT e.twin_id) AS twin_count,
    count(*) FILTER (WHERE t.entity_type = 'person') AS person_events,
    count(*) FILTER (WHERE t.entity_type = 'organization') AS organization_events
   FROM twin_events e
   JOIN twin_entities t ON t.id = e.twin_id
  WHERE e.occurred_at IS NOT NULL
    AND e.event_type <> 'parameter'
  GROUP BY 1, 2;

COMMENT ON VIEW public.audience_admin_activity_monthly_v IS
  'Aktivita v čase: doteky po měsících a druzích nad dvojčaty (twin_events).
   Nahrazuje měření starého modelu profiles/openclaw_notifications.';

-- ⛔ Pohled s právy VLASTNÍKA (bez security_invoker) čte podklad MIMO jeho RLS.
-- Čte se JEN přes DEFINER blokové funkce get_audience_view_*_block (stráž
-- is_admin_or_staff + jmenný prostor audience_admin_*_v). Přímý grant klientské
-- roli tu stráž obcházel přes /rest/v1/ (naměřeno na čisté DB main 0f992f647:
-- authenticated SELECT, u followup_queue/twin_directory i DML z default privileges).
-- REVOKE i z anon/authenticated: na běžící DB žijí explicitní granty z dřívějších
-- bloků heals a z ALTER DEFAULT PRIVILEGES při každém DROP+CREATE pohledu.
-- Třídu hlídá src/tests/db/pohled-s-pravy-vlastnika-bez-klientskeho-grantu.runtime.test.ts.
REVOKE ALL ON public.audience_admin_activity_monthly_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audience_admin_activity_monthly_v TO service_role;

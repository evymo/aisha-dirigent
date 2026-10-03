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

REVOKE ALL ON public.audience_admin_activity_monthly_v FROM PUBLIC;
GRANT SELECT ON public.audience_admin_activity_monthly_v TO authenticated, service_role;

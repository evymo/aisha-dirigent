-- ============================================================================
-- Source of Truth: avp_project_fuelings
-- Popis: TENKÝ ADAPTÉR výdejů AVP (obecná surová dráha source_catalog_rows,
--        zdroj 'avp-portal', druh 'fueling') → twin_project_events. Přeloží
--        řádky do tvaru jádra; identitu, druh entity, porovnání a zápis dělá
--        jádro. Událost 'fueling' na dvojčeti vozidla, řidič = druhá strana,
--        dráha 'avp-portal:fueling' (katalog fueling_liters čte atribut liters).
--
-- KDO TANKOVAL (soupis ostré instance 19. 8., 9 880 výdejů): výdej nese kartu
-- vozidla (vehicleId, jen 70 %) a kartu řidiče (driverId, 98 %) z /cards,
-- a vždy kódy čipů. Subjekt = karta vozidla ('karta:<id>', primary_id); kde
-- karta chybí, čip vozidla ('cip:<kód>', field_identity — resolve k ČASU
-- výdeje, čip se může přesunout). Řidič stejně. Výdej bez karty i čipu
-- vozidla nemá komu patřit (kanystr, neznámé) — jen se spočítá.
--
-- PLATNÁ VERZE (tamtéž, naivní filtr nafoukne počet o ~19 %): poslední článek
-- řetězu oprav parent_id ∧ ¬hidden ∧ ¬removed. Posílají se VŠECHNY verze, litry
-- ale nese jen platná; nahrazená/skrytá/odstraněná má liters = null a `stav`.
-- Oprava, která přijde později, tak předchozí verzi v dvojčeti VYNULUJE jako
-- změnu události — součet ji přestane počítat, nic se nemaže.
--
-- Které výdeje posílá (šetrně, volá se po každé synchronizaci):
--   • dosud NEPROMÍTNUTÉ výdeje s platnou vazbou subjektu k času výdeje,
--   • výdeje, na které synchronizace sáhla v posledních `p_okno_min` minutách,
--   • RODIČE takových výdejů (jejich platnost se novou opravou změnila).
-- Cena (unit_price bývá 0) ani dopočtený stav nádrže se nepřenáší.
--
-- Vrací: výsledek twin_project_events + {ceka_na_vazbu, bez_vozidla}
-- Bezpečnost: SECURITY DEFINER; jen service_role (volá plugin přes broker).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.avp_project_fuelings(
  p_okno_min integer DEFAULT 180,
  p_limit    integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_source   constant text := 'avp-portal';
  v_source   text;
  v_lane     text;
  v_rows     jsonb;
  v_ceka     integer;
  v_bez      integer;
  v_vysledek jsonb;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'avp_project_fuelings: service role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_okno_min IS NULL OR p_okno_min < 0 OR p_okno_min > 10080 THEN
    RAISE EXCEPTION 'avp_project_fuelings: p_okno_min must be between 0 and 10080'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 20000 THEN
    RAISE EXCEPTION 'avp_project_fuelings: p_limit must be between 1 and 20000'
      USING ERRCODE = '22023';
  END IF;
  v_source := public.canonical_ingest_source(c_source);
  v_lane   := v_source || ':fueling';

  WITH vydeje AS (
    SELECT c.external_id, c.occurred_at, c.synced_at, c.fields
      FROM public.source_catalog_rows c
     WHERE c.source_slug = c_source AND c.kind = 'fueling' AND c.occurred_at IS NOT NULL
  ),
  rodice AS (
    -- Množina nahrazených verzí se spočítá JEDNOU (hash), ne dotazem na řádek.
    -- Z katalogu, ne z odpovědi API: rodič bývá mimo aktuální okno synchronizace.
    SELECT DISTINCT v.fields->>'parent_id' AS pid
      FROM vydeje v
     WHERE nullif(v.fields->>'parent_id', '') IS NOT NULL
  ),
  urceni AS (
    SELECT v.external_id, v.occurred_at, v.synced_at, v.fields,
           CASE WHEN nullif(v.fields->>'vehicle_id', '') IS NOT NULL THEN 'karta:' || (v.fields->>'vehicle_id')
                WHEN nullif(v.fields->>'vehicle_chip', '') IS NOT NULL THEN 'cip:' || upper(v.fields->>'vehicle_chip')
           END AS v_key,
           CASE WHEN nullif(v.fields->>'vehicle_id', '') IS NOT NULL THEN 'primary_id' ELSE 'field_identity' END AS v_kind,
           CASE WHEN nullif(v.fields->>'driver_id', '') IS NOT NULL THEN 'karta:' || (v.fields->>'driver_id')
                WHEN nullif(v.fields->>'driver_chip', '') IS NOT NULL THEN 'cip:' || upper(v.fields->>'driver_chip')
           END AS d_key,
           CASE WHEN nullif(v.fields->>'driver_id', '') IS NOT NULL THEN 'primary_id' ELSE 'field_identity' END AS d_kind,
           CASE WHEN coalesce((v.fields->>'removed')::boolean, false) THEN 'odstraneno'
                WHEN coalesce((v.fields->>'hidden')::boolean, false)  THEN 'skryto'
                WHEN r.pid IS NOT NULL                                THEN 'nahrazeno'
                ELSE 'platne' END AS stav
      FROM vydeje v
      LEFT JOIN rodice r ON r.pid = v.external_id
  ),
  vse AS (
    SELECT u.external_id, u.occurred_at, u.synced_at, u.fields, u.v_key, u.v_kind, u.d_key, u.d_kind, u.stav,
           EXISTS (SELECT 1 FROM public.twin_events e
                    WHERE e.source = v_lane AND e.event_type = 'fueling' AND e.source_ref = u.external_id) AS promitnuto,
           -- Levné předběžné síto: vazba subjektu k času výdeje; rozhoduje jádro.
           EXISTS (SELECT 1 FROM public.twin_external_refs b
                    WHERE b.source = v_source AND b.source_key = u.v_key AND b.ref_kind = u.v_kind
                      AND b.state = 'confirmed'
                      AND b.valid_from <= u.occurred_at
                      AND (b.valid_to IS NULL OR b.valid_to > u.occurred_at)) AS vazba
      FROM urceni u
     WHERE u.v_key IS NOT NULL
  ),
  nedavne AS (
    SELECT a.external_id, a.fields->>'parent_id' AS pid
      FROM vse a
     WHERE a.synced_at >= now() - make_interval(mins => p_okno_min)
  ),
  kandidati AS (
    SELECT a.external_id, a.occurred_at, a.fields, a.v_key, a.v_kind, a.d_key, a.d_kind, a.stav
      FROM vse a
     WHERE a.vazba
       AND (NOT a.promitnuto
            OR EXISTS (SELECT 1 FROM nedavne n WHERE n.external_id = a.external_id)
            OR EXISTS (SELECT 1 FROM nedavne n WHERE n.pid = a.external_id))
     ORDER BY a.occurred_at
     LIMIT p_limit
  )
  SELECT
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
              'event_type',  'fueling',
              'lane',        'fueling',
              'source_ref',  k.external_id,
              'subject',     jsonb_build_object('key', k.v_key, 'ref_kind', k.v_kind, 'entity_type', 'vehicle'),
              'related',     CASE WHEN k.d_key IS NOT NULL
                                  THEN jsonb_build_object('key', k.d_key, 'ref_kind', k.d_kind, 'entity_type', 'driver')
                             END,
              'occurred_at', k.occurred_at,
              'attrs',       jsonb_strip_nulls(jsonb_build_object(
                               'liters',             CASE WHEN k.stav = 'platne' THEN k.fields->'liters' END,
                               'compensated_liters', CASE WHEN k.stav = 'platne' THEN k.fields->'compensated_liters' END,
                               'duration_s',         k.fields->'duration_s',
                               'tank_id',            k.fields->'tank_id',
                               'stav',               k.stav,
                               'vozidlo_z_cipu',     CASE WHEN k.v_kind = 'field_identity' THEN true END))
            ) ORDER BY k.occurred_at), '[]'::jsonb)
       FROM kandidati k),
    -- Kolik výdejů čeká na člověka (vazba vozidla chybí nebo k času výdeje neplatí).
    (SELECT count(*) FROM vse a WHERE NOT a.promitnuto AND NOT a.vazba)
  INTO v_rows, v_ceka;

  SELECT count(*) INTO v_bez
    FROM public.source_catalog_rows c
   WHERE c.source_slug = c_source AND c.kind = 'fueling'
     AND nullif(c.fields->>'vehicle_id', '') IS NULL
     AND nullif(c.fields->>'vehicle_chip', '') IS NULL;

  v_vysledek := public.twin_project_events(c_source, v_rows);
  RETURN v_vysledek || jsonb_build_object('ceka_na_vazbu', v_ceka, 'bez_vozidla', v_bez);
END;
$$;

REVOKE ALL ON FUNCTION public.avp_project_fuelings(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avp_project_fuelings(integer, integer) TO service_role;

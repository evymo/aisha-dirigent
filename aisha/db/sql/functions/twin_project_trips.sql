-- ============================================================================
-- Source of Truth: twin_project_trips
-- Popis: Jízdy ZDROJE → události 'trip' na dvojčeti vozidla (řidič = druhá
--        strana). Obecné jádro projekce: nezná dodavatele ani jeho tabulky —
--        dostane řádky v jednom tvaru a zdroj, jehož vazby identity platí.
--        Adaptér zdroje (dnes čte vendor tabulku, zítra řady source_catalog_rows)
--        jen přeloží své řádky do tohoto tvaru; jádro se při přepojení nemění.
--
-- IDENTITA: vozidlo i řidič se resolvují přes twin_identity_resolve VÝHRADNĚ
-- pro zdroj `p_source` a k ČASU JÍZDY. Jen potvrzené a tehdy platné vazby —
-- návrhy runtime nevidí. Jízda bez vazby vozidla se NEZAPÍŠE a nic se kvůli ní
-- nezakládá (jen se spočítá); promítne se při dalším volání, až bude vazba
-- potvrzená a platná (adaptér posílá každou dosud nepromítnutou jízdu).
-- Řidič bez vazby jízdu neblokuje — událost ho prostě nemá.
--
-- ZÁPIS: jen NOVÉ nebo ZMĚNĚNÉ události (porovnává s tím, co už v twin_events
-- leží). Zdroje opravují jízdy zpětně a adaptéry čtou s překryvem oken — bez
-- porovnání by každé volání přepsalo a zauditovalo celé okno beze změny.
-- Samotný zápis jde přes twin_record_events_audited (dedup přes
-- (source, event_type, source_ref), audit bez osobních údajů).
--
-- `source` události = '<p_source>:trip' (dráha zdroje, vzor Eurowagu), takže
-- čtečky vidí, kdo co tvrdí, a dedup jízd se nepotká s jinými událostmi zdroje.
--
-- Vstup p_rows: [{ "source_ref": "<id jízdy ve zdroji>",
--                  "vehicle_key": "<id vozidla ve zdroji>",
--                  "driver_key":  "<id řidiče ve zdroji>" | null,
--                  "started_at": "<ISO>", "ended_at": "<ISO>" | null,
--                  "attrs": { "distance_km": …, "consumption_l": …, … } }, …]
--   Jména atributů určuje katalog parametrů (`twin_parameter_definitions.
--   metadata.attr`), ne tahle funkce.
--
-- Od 2026-09-27 OBAL nad twin_project_events (viz tělo) — chování i tvar beze změny,
-- navíc `jiny_druh` (vazba vedla na dvojče jiného druhu → nezapsáno).
--
-- Vrací: {prijato, nove, zmenene, beze_zmeny, bez_vazby_vozidla, jiny_druh, neplatne}
-- Bezpečnost: SECURITY DEFINER; jen service_role (projekci spouští zdroj).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.twin_project_trips(
  p_source text,
  p_rows   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_obecne   jsonb;
  v_vysledek jsonb;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'twin_project_trips: service role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'twin_project_trips: p_rows must be a jsonb array'
      USING ERRCODE = '22023';
  END IF;

  -- Jízda = obecná událost 'trip' na dvojčeti vozidla, řidič je druhá strana.
  -- Od 2026-09-27 je to jen OBAL nad twin_project_events (identita, druh
  -- entity, porovnání a zápis žijí na jednom místě); tvar vstupu i výsledku
  -- zůstal, aby adaptéry jízd nemusely nic měnit. Druh entity lze v řádku
  -- přebít (`vehicle_type`, `driver_type`), výchozí je slovník, který jádro
  -- dvojčat používá i jinde.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'event_type',  'trip',
           'lane',        'trip',
           'source_ref',  r->'source_ref',
           'subject',     jsonb_build_object(
                            'key',         r->'vehicle_key',
                            'ref_kind',    'primary_id',
                            'entity_type', coalesce(nullif(btrim(r->>'vehicle_type'), ''), 'vehicle')),
           'related',     CASE WHEN nullif(btrim(r->>'driver_key'), '') IS NOT NULL
                               THEN jsonb_build_object(
                                      'key',         r->'driver_key',
                                      'ref_kind',    'primary_id',
                                      'entity_type', coalesce(nullif(btrim(r->>'driver_type'), ''), 'driver'))
                          END,
           'occurred_at', r->'started_at',
           'ended_at',    r->'ended_at',
           'attrs',       r->'attrs'
         )), '[]'::jsonb)
    INTO v_obecne
    FROM jsonb_array_elements(p_rows) AS r;

  v_vysledek := public.twin_project_events(p_source, v_obecne);

  RETURN jsonb_build_object(
    'prijato',           v_vysledek->'prijato',
    'nove',              v_vysledek->'nove',
    'zmenene',           v_vysledek->'zmenene',
    'beze_zmeny',        v_vysledek->'beze_zmeny',
    'bez_vazby_vozidla', v_vysledek->'bez_vazby',
    'jiny_druh',         v_vysledek->'jiny_druh',
    'neplatne',          v_vysledek->'neplatne'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.twin_project_trips(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.twin_project_trips(text, jsonb) TO service_role;

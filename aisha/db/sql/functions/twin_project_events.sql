-- ============================================================================
-- Source of Truth: twin_project_events
-- Popis: Záznamy ZDROJE → události dvojčat. Obecné jádro projekce: nezná
--        dodavatele ani jeho tabulky — dostane řádky v jednom tvaru a zdroj,
--        jehož vazby identity platí. Jízda, tankování, činnost řidiče z
--        tachografu i hladina ze sondy jsou tentýž tvar: KDO (subjekt), s KÝM
--        (druhá strana), KDY, CO (atributy) — liší se typem události a dráhou.
--        Adaptér zdroje (vendor tabulka nebo řady source_catalog_rows) jen
--        přeloží své řádky; jádro se při přepojení zdroje nemění.
--
-- IDENTITA: subjekt i druhá strana se resolvují přes twin_identity_resolve
-- VÝHRADNĚ pro zdroj `p_source`, podle `ref_kind` řádku (primární klíč, čip…)
-- a k ČASU UDÁLOSTI — jen potvrzené a tehdy platné vazby (čip se tak přiřadí
-- tehdejšímu držiteli, ne dnešnímu). Navíc musí dvojče mít DRUH, který řádek
-- čeká (`entity_type`): vazba identity je dnes jedinečná jen v (source,
-- source_key, ref_kind), bez druhu entity, takže adaptér, který by zapomněl
-- odlišit klíč vozidla od klíče osoby, by jinak přiřadil jízdu řidiči-vozidlu
-- (nalezeno 2026-09-27 u T-cars). Adaptéry klíče rozlišují samy; tohle je
-- druhá pojistka.
--
-- Nerozřešený subjekt se NEZAPÍŠE a nic se kvůli němu nezakládá — jen se
-- spočítá. Adaptér posílá každý dosud nepromítnutý záznam znovu, takže se
-- promítne sám, až člověk vazbu potvrdí. Nerozřešená druhá strana událost
-- neblokuje, jen ji nemá.
--
-- ZÁPIS: jen NOVÉ nebo ZMĚNĚNÉ události (porovnání s twin_events); zdroje
-- opravují zpětně a adaptéry čtou s překryvem, bez porovnání by každé volání
-- zauditovalo celé okno. Zápis přes twin_record_events_audited (dedup
-- (source, event_type, source_ref)). `source` události = '<p_source>:<lane>'.
--
-- Vstup p_rows: [{ "event_type": "trip", "lane": "trip",
--                  "source_ref": "<id záznamu ve zdroji>",
--                  "subject": {"key": "…", "ref_kind": "primary_id", "entity_type": "vehicle"},
--                  "related": {"key": "…", "ref_kind": "field_identity", "entity_type": "driver"} | null,
--                  "occurred_at": "<ISO>", "ended_at": "<ISO>" | null,
--                  "attrs": { … } }, …]
--   `lane` chybí → rovná se typu události; `ref_kind` chybí → 'primary_id'.
--   Jména typů událostí, drah, druhů entit i atributů určují DATA (katalog
--   parametrů, adaptér), ne tahle funkce.
--
-- Vrací: {prijato, nove, zmenene, beze_zmeny, bez_vazby, jiny_druh, neplatne}
--   bez_vazby = subjekt bez potvrzené a k času platné vazby;
--   jiny_druh = vazba vede na dvojče jiného druhu, než řádek čeká (subjekt
--               se pak nezapíše, druhá strana se vynechá) — vada adaptéru;
--   neplatne  = chybí povinný údaj nebo konec před začátkem.
-- Bezpečnost: SECURITY DEFINER; jen service_role (projekci spouští zdroj).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.twin_project_events(
  p_source text,
  p_rows   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_source   text;
  v_prijato  integer;
  v_neplatne integer;
  v_bez      integer;
  v_druh     integer;
  v_nove     integer;
  v_zmenene  integer;
  v_udalosti integer;
  v_zapis    jsonb;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'twin_project_events: service role required'
      USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_source), '') = '' THEN
    RAISE EXCEPTION 'twin_project_events: source is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'twin_project_events: p_rows must be a jsonb array'
      USING ERRCODE = '22023';
  END IF;
  v_source := public.canonical_ingest_source(btrim(p_source));

  WITH vstup AS (
    SELECT nullif(btrim(r->>'event_type'), '')                           AS event_type,
           coalesce(nullif(btrim(r->>'lane'), ''), nullif(btrim(r->>'event_type'), '')) AS lane,
           nullif(btrim(r->>'source_ref'), '')                           AS source_ref,
           nullif(btrim(r->'subject'->>'key'), '')                       AS s_key,
           coalesce(nullif(btrim(r->'subject'->>'ref_kind'), ''), 'primary_id') AS s_kind,
           nullif(btrim(r->'subject'->>'entity_type'), '')               AS s_type,
           nullif(btrim(r->'related'->>'key'), '')                       AS r_key,
           coalesce(nullif(btrim(r->'related'->>'ref_kind'), ''), 'primary_id') AS r_kind,
           nullif(btrim(r->'related'->>'entity_type'), '')               AS r_type,
           CASE WHEN jsonb_typeof(r->'attrs') = 'object' THEN r->'attrs' ELSE '{}'::jsonb END AS attrs,
           nullif(r->>'occurred_at', '')                                 AS occurred_raw,
           nullif(r->>'ended_at', '')                                    AS ended_raw
      FROM jsonb_array_elements(p_rows) AS r
  ),
  platne AS (
    -- Bez typu, klíče záznamu, subjektu (i jeho druhu) nebo času nemá událost
    -- kam patřit ani jak se deduplikovat. Konec před začátkem (dodavatel to
    -- umí) by odmítla tabulka a shodila celou dávku — neplatný řádek. Nečitelný
    -- čas naopak SPADNE nahlas: adaptér čte typované hodnoty, takže je to vada
    -- adaptéru, ne dat.
    SELECT v.event_type, v.lane, v.source_ref, v.s_key, v.s_kind, v.s_type,
           v.r_key, v.r_kind, v.r_type, v.attrs,
           v.occurred_raw::timestamptz AS occurred_at,
           v.ended_raw::timestamptz    AS ended_at
      FROM vstup v
     WHERE v.event_type IS NOT NULL
       AND v.source_ref IS NOT NULL
       AND v.s_key IS NOT NULL
       AND v.s_type IS NOT NULL
       AND v.occurred_raw IS NOT NULL
  ),
  platne_casy AS (
    SELECT p.event_type, p.lane, p.source_ref, p.s_key, p.s_kind, p.s_type,
           p.r_key, p.r_kind, p.r_type, p.attrs, p.occurred_at, p.ended_at
      FROM platne p
     WHERE p.ended_at IS NULL OR p.ended_at >= p.occurred_at
  ),
  rozreseno AS (
    SELECT p.event_type, p.lane, p.source_ref, p.s_type, p.r_type, p.attrs,
           p.occurred_at, p.ended_at,
           public.twin_identity_resolve(v_source, p.s_key, p.s_kind, p.occurred_at) AS s_twin,
           CASE WHEN p.r_key IS NOT NULL
                THEN public.twin_identity_resolve(v_source, p.r_key, p.r_kind, p.occurred_at)
           END AS r_twin
      FROM platne_casy p
  ),
  s_druhem AS (
    SELECT r.event_type, r.lane, r.source_ref, r.attrs, r.occurred_at, r.ended_at,
           r.s_twin,
           (r.s_twin IS NOT NULL AND ts.entity_type IS DISTINCT FROM r.s_type) AS s_jiny,
           CASE WHEN r.r_twin IS NOT NULL
                 AND (r.r_type IS NULL OR tr.entity_type = r.r_type)
                THEN r.r_twin END AS r_twin,
           (r.r_twin IS NOT NULL AND r.r_type IS NOT NULL
            AND tr.entity_type IS DISTINCT FROM r.r_type) AS r_jiny
      FROM rozreseno r
      LEFT JOIN public.twin_entities ts ON ts.id = r.s_twin
      LEFT JOIN public.twin_entities tr ON tr.id = r.r_twin
  ),
  udalosti AS (
    SELECT d.event_type, d.source_ref, d.attrs, d.occurred_at, d.ended_at,
           d.s_twin, d.r_twin,
           v_source || ':' || d.lane AS draha,
           e.id AS existujici,
           (e.id IS NOT NULL AND (
              e.twin_id IS DISTINCT FROM d.s_twin
              OR e.related_twin_id IS DISTINCT FROM d.r_twin
              OR e.occurred_at IS DISTINCT FROM d.occurred_at
              OR e.ended_at IS DISTINCT FROM d.ended_at
              OR e.attrs IS DISTINCT FROM d.attrs)) AS zmena
      FROM s_druhem d
      LEFT JOIN public.twin_events e
        ON e.source = v_source || ':' || d.lane
       AND e.event_type = d.event_type
       AND e.source_ref = d.source_ref
     WHERE d.s_twin IS NOT NULL AND NOT d.s_jiny
  )
  SELECT
    (SELECT count(*) FROM vstup),
    (SELECT count(*) FROM vstup) - (SELECT count(*) FROM platne_casy),
    (SELECT count(*) FROM s_druhem WHERE s_twin IS NULL),
    (SELECT count(*) FROM s_druhem WHERE s_jiny OR r_jiny),
    (SELECT count(*) FROM udalosti WHERE existujici IS NULL),
    (SELECT count(*) FROM udalosti WHERE zmena),
    (SELECT count(*) FROM udalosti),
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
              'event_type',      u.event_type,
              'twin_id',         u.s_twin,
              'related_twin_id', u.r_twin,
              'occurred_at',     u.occurred_at,
              'ended_at',        u.ended_at,
              'attrs',           u.attrs,
              'source',          u.draha,
              'source_ref',      u.source_ref)), '[]'::jsonb)
       FROM udalosti u
      WHERE u.existujici IS NULL OR u.zmena)
  INTO v_prijato, v_neplatne, v_bez, v_druh, v_nove, v_zmenene, v_udalosti, v_zapis;

  -- Prázdná dávka nic nezapisuje ani neaudituje (takt beze změn).
  IF jsonb_array_length(v_zapis) > 0 THEN
    PERFORM public.twin_record_events_audited(v_zapis);
  END IF;

  RETURN jsonb_build_object(
    'prijato',    v_prijato,
    'nove',       v_nove,
    'zmenene',    v_zmenene,
    'beze_zmeny', v_udalosti - v_nove - v_zmenene,
    'bez_vazby',  v_bez,
    'jiny_druh',  v_druh,
    'neplatne',   v_neplatne
  );
END;
$$;

REVOKE ALL ON FUNCTION public.twin_project_events(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.twin_project_events(text, jsonb) TO service_role;

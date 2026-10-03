-- ============================================================================
-- Source of Truth: get_twin_metric_kpi_block
-- Popis: GENERICKÁ dlaždice čísla (maska `kpi_tile`) nad substrátem dvojčat.
--        Co se počítá, říká KONFIGURACE bloku, ne kód: `param` je kód
--        z katalogu (`twin_parameter_definitions`), `agg` je uzavřená množina
--        agregací a okno je od–do. Sourozenec `get_audience_view_kpi_block`
--        (tamtéž nad pohledy publika), jen substrát je jiný.
--
-- Konfigurace (p_params):
--   param        POVINNÉ   kód parametru v katalogu
--   agg          volitelné sum (default) | avg | count | count_distinct | last
--                          | max | min | ratio | days_since_last
--                          UZAVŘENÁ množina; neznámá hodnota degraduje na 'sum'
--   per_param    u `ratio` POVINNÉ — jmenovatel (Σ param / Σ per_param)
--   factor       u `ratio` volitelné násobení (l/100 km = Σ l / Σ km × 100)
--   entity_type  volitelné zúžení druhu entity (katalog dává výchozí)
--   date_from,
--   date_to      volitelné ABSOLUTNÍ okno ('YYYY-MM-DD' nebo ISO čas)
--   days         volitelné relativní okno (default 7), když od–do nepřijde
--   tz           volitelné pásmo, ve kterém se čte HOLÉ datum a v němž
--                          začíná den (default 'UTC'). Pro dopravce v Česku
--                          patří do bloku 'Europe/Prague': den začíná půlnocí
--                          v Praze, ne v Londýně — jízda v 00:30 by jinak
--                          spadla do předchozího dne. Neznámé pásmo degraduje
--                          na UTC, nezhasne blok.
--   compare      volitelné 'previous' → delta_pct proti stejně dlouhému oknu PŘED
--   unit_key     volitelné i18n klíč jednotky
--   state        volitelné 'ok' (default) | 'warning' | 'loss' — STAV JE
--                          DEKLARACE: funkce neví, jestli je víc lépe, nebo hůř
--
-- ⭐ `value: null` = NEMĚŘENO a je to platná odpověď: prázdné okno, parametr,
--    který katalog nezná, i chybějící právo vypadají stejně — nula by tvrdila
--    měření, které nikdo neprovedl. Důvod nese `trace_id`, ne data. Platí to
--    i pro POČÍTADLA: `count`/`count_distinct` nad prázdnem vrací 0, ale „nic
--    nejezdilo" a „nikdo neměřil" jsou dvě různé věty a substrát je nerozliší.
--
-- Provenance se ODVOZUJE z dat: `source_slug` je seznam zdrojů, které do okna
--    přispěly, `freshness_at` je čas POSLEDNÍ hodnoty (ne `now()` — čerstvost
--    měřidla není čerstvost dotazu). Bez dat je čerstvost `now()` a trace
--    končí `:no_data`, aby se prázdno nedalo číst jako aktuální nula.
--
-- Bezpečnost: SECURITY INVOKER — RLS na twin_* fail-closed (viz twin_param_values).
-- Kontrakt: (jsonb) -> jsonb {data:{value,unit_key,delta_pct,state}, provenance}.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_twin_metric_kpi_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_param    text := NULLIF(btrim(COALESCE(p_params->>'param', '')), '');
  v_per      text := NULLIF(btrim(COALESCE(p_params->>'per_param', '')), '');
  v_factor   numeric := COALESCE((p_params->>'factor')::numeric, 1);
  v_agg      text := lower(COALESCE(NULLIF(btrim(COALESCE(p_params->>'agg', '')), ''), 'sum'));
  v_entity   text := NULLIF(btrim(COALESCE(p_params->>'entity_type', '')), '');
  v_unit     text := NULLIF(btrim(COALESCE(p_params->>'unit_key', '')), '');
  v_state    text := lower(COALESCE(NULLIF(btrim(COALESCE(p_params->>'state', '')), ''), 'ok'));
  v_compare  text := lower(COALESCE(NULLIF(btrim(COALESCE(p_params->>'compare', '')), ''), ''));
  v_tz      text := COALESCE(NULLIF(btrim(COALESCE(p_params->>'tz', '')), ''), 'UTC');
  v_now      timestamptz := now();
  v_from     timestamptz;
  v_to       timestamptz;
  v_len      interval;
  v_value    numeric;
  v_prev     numeric;
  v_delta    numeric;
  v_fresh    timestamptz;
  v_sources  text;
  v_reason   text := '';
BEGIN
  -- Neznámé pásmo (překlep v deklaraci bloku) NESMÍ shodit plochu: degraduje
  -- na UTC. Ověřuje se proti katalogu pásem, ne proti vlastnímu seznamu.
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_tz) THEN v_tz := 'UTC'; END IF;

  IF v_agg NOT IN ('sum','avg','count','count_distinct','last','max','min','ratio','days_since_last')
    THEN v_agg := 'sum'; END IF;
  IF v_state NOT IN ('ok','warning','loss') THEN v_state := 'ok'; END IF;

  -- Okno: ABSOLUTNÍ přebíjí relativní. Tvar se OVĚŘUJE, nepřetypovává naslepo —
  -- překlep v datu jinak neshodí filtr, ale celý blok.
  IF p_params->>'date_from' ~ '^\d{4}-\d{2}-\d{2}' AND p_params->>'date_to' ~ '^\d{4}-\d{2}-\d{2}' THEN
    -- Holé datum = půlnoc V PÁSMU BLOKU; údaj s časem zůstává absolutním
    -- okamžikem (kdo pošle čas i posun, ví, co chce).
    v_from := CASE WHEN p_params->>'date_from' ~ '^\d{4}-\d{2}-\d{2}$'
                   THEN (p_params->>'date_from')::timestamp AT TIME ZONE v_tz
                   ELSE (p_params->>'date_from')::timestamptz END;
    -- Den „do" je včetně: konec okna je půlnoc NÁSLEDUJÍCÍHO dne v témže pásmu.
    v_to := CASE WHEN p_params->>'date_to' ~ '^\d{4}-\d{2}-\d{2}$'
                 THEN ((p_params->>'date_to')::date + 1)::timestamp AT TIME ZONE v_tz
                 ELSE (p_params->>'date_to')::timestamptz END;
  ELSE
    v_to   := v_now;
    v_from := v_now - make_interval(days => GREATEST(COALESCE((p_params->>'days')::int, 7), 1));
  END IF;
  v_len := v_to - v_from;

  IF v_param IS NULL OR (v_agg = 'ratio' AND v_per IS NULL) THEN
    RETURN jsonb_build_object(
      'data', jsonb_build_object('value', NULL, 'state', v_state),
      'provenance', jsonb_build_object(
        'source_slug', 'twin-metric',
        'freshness_at', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'trace_id', 'twin-metric-kpi:missing_config'));
  END IF;

  -- Katalog rozhoduje, kde hodnota leží; parametr, který nezná, je NEMĚŘENO
  -- (ne pád) — plocha smí být napřed před slovníkem, ale nesmí si vymýšlet.
  IF NOT EXISTS (SELECT 1 FROM public.twin_parameter_definitions d WHERE d.code = v_param) THEN
    v_reason := ':unknown_param';
  END IF;

  SELECT
    CASE v_agg
      WHEN 'sum'            THEN sum(v.value)
      WHEN 'avg'            THEN avg(v.value)
      WHEN 'count'          THEN count(*)::numeric
      WHEN 'count_distinct' THEN count(DISTINCT v.twin_id)::numeric
      WHEN 'max'            THEN max(v.value)
      WHEN 'min'            THEN min(v.value)
      WHEN 'days_since_last' THEN floor(extract(epoch FROM (v_now - max(v.occurred_at))) / 86400)
      ELSE NULL
    END,
    max(v.occurred_at),
    string_agg(DISTINCT v.source, '+' ORDER BY v.source)
  INTO v_value, v_fresh, v_sources
  FROM public.twin_param_values(v_param, v_from, v_to, v_entity) v;

  IF v_agg = 'last' THEN
    SELECT v.value INTO v_value
    FROM public.twin_param_values(v_param, v_from, v_to, v_entity) v
    WHERE v.value IS NOT NULL
    ORDER BY v.occurred_at DESC
    LIMIT 1;
  ELSIF v_agg = 'ratio' THEN
    -- Vážený poměr: Σ čitatele / Σ jmenovatele. NE průměr poměrů po řádcích —
    -- ten dá krátké jízdě tutéž váhu jako dlouhé a l/100 km pak lže.
    SELECT v_factor * sum(v.value)
                 / NULLIF((SELECT sum(w.value)
                           FROM public.twin_param_values(v_per, v_from, v_to, v_entity) w), 0)
    INTO v_value
    FROM public.twin_param_values(v_param, v_from, v_to, v_entity) v;
  END IF;

  -- ⭐ POČÍTADLO NAD PRÁZDNEM není nula. `count`/`count_distinct` vrátí nad
  -- prázdnou množinou 0, a dlaždice „aktivní vozidla" by tak tvrdila „žádné
  -- nejezdí" i tam, kde jen nikdo neměří. Rozlišit „zdroj mlčí" od „nic se
  -- nedělo" substrát neumí — a když to neumí, je pravdivá odpověď NEMĚŘENO.
  -- `v_fresh` je NULL přesně tehdy, když do okna nepřišel ani jeden řádek.
  IF v_fresh IS NULL THEN v_value := NULL; END IF;

  -- Zaokrouhlení JEDNOU, až nad hotovou agregací — hodnoty přicházejí v jednotce
  -- parametru (katalog umí převod s → h) a ta dává periodická desetinná místa.
  v_value := trim_scale(round(v_value, 2));

  IF v_compare = 'previous' AND v_value IS NOT NULL AND v_agg <> 'days_since_last' THEN
    SELECT
      CASE v_agg
        WHEN 'sum'            THEN sum(v.value)
        WHEN 'avg'            THEN avg(v.value)
        WHEN 'count'          THEN count(*)::numeric
        WHEN 'count_distinct' THEN count(DISTINCT v.twin_id)::numeric
        WHEN 'max'            THEN max(v.value)
        WHEN 'min'            THEN min(v.value)
        ELSE NULL
      END
    INTO v_prev
    FROM public.twin_param_values(v_param, v_from - v_len, v_from, v_entity) v;

    IF v_agg = 'ratio' THEN
      SELECT v_factor * sum(v.value)
                   / NULLIF((SELECT sum(w.value)
                             FROM public.twin_param_values(v_per, v_from - v_len, v_from, v_entity) w), 0)
      INTO v_prev
      FROM public.twin_param_values(v_param, v_from - v_len, v_from, v_entity) v;
    ELSIF v_agg = 'last' THEN
      SELECT v.value INTO v_prev
      FROM public.twin_param_values(v_param, v_from - v_len, v_from, v_entity) v
      WHERE v.value IS NOT NULL
      ORDER BY v.occurred_at DESC
      LIMIT 1;
    END IF;

    -- Srovnávané období projde TOUTÉŽ cestou: kdyby se zaokrouhlilo jen jedno
    -- z čísel, změna by se vykázala i tam, kde se nic nestalo. A prázdné
    -- minulé období je taky NEMĚŘENO — nula by vyrobila skok o 100 %.
    IF NOT EXISTS (SELECT 1 FROM public.twin_param_values(v_param, v_from - v_len, v_from, v_entity))
      THEN v_prev := NULL; END IF;
    v_prev := trim_scale(round(v_prev, 2));

    IF v_prev IS NOT NULL AND v_prev <> 0 THEN
      v_delta := round((v_value - v_prev) / abs(v_prev) * 100, 1);
    END IF;
  END IF;

  IF v_value IS NULL AND v_reason = '' THEN v_reason := ':no_data'; END IF;

  -- `value` stojí MIMO jsonb_strip_nulls: null je tu odpověď (NEMĚŘENO), ne
  -- chybějící pole. Maska kpi_tile má `value` povinné a null výslovně povoluje;
  -- kdyby ho strip smazal, shell celou dlaždici zahodí jako porušení kontraktu
  -- (naměřeno v produkci 2026-09-24: 7/7 dlaždic vozového parku bez dat zmizelo).
  -- Ostatní klíče null nesmí nést vůbec, proto je strip dál čistí.
  RETURN jsonb_build_object(
    'data', jsonb_build_object('value', v_value)
            || jsonb_strip_nulls(jsonb_build_object(
                 'unit_key', v_unit,
                 'delta_pct', v_delta,
                 'state', v_state)),
    'provenance', jsonb_build_object(
      'source_slug', COALESCE(v_sources, 'twin-metric'),
      'freshness_at', to_char(COALESCE(v_fresh, v_now) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id', 'twin-metric-kpi:' || v_param || ':' || v_agg || v_reason));
END;
$$;

COMMENT ON FUNCTION public.get_twin_metric_kpi_block(jsonb) IS
  'Generická dlaždice čísla nad dvojčaty: parametr z katalogu × uzavřená agregace × okno od–do; hodnota null = NEMĚŘENO, provenance z dat.';

REVOKE ALL ON FUNCTION public.get_twin_metric_kpi_block(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_twin_metric_kpi_block(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_twin_metric_kpi_block(jsonb) TO service_role;

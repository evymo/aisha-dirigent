-- ============================================================================
-- Source of Truth: get_twin_metric_chart_block
-- Popis: GENERICKÝ graf nad substrátem dvojčat (maska `chart`). Dvě osy, jedna
--        funkce: `bar` = veličina PO ENTITÁCH (kdo pije nejvíc), `trend` =
--        tatáž veličina PO OBDOBÍCH (jak to šlo v čase). Co se kreslí, říká
--        konfigurace bloku; jméno události ani atributu funkce nezná (katalog).
--
-- Konfigurace (p_params):
--   param       POVINNÉ  kód parametru z katalogu
--   agg         volitelné sum (default) | avg | count | max | min | ratio
--   per_param,
--   factor      u `ratio` jmenovatel a násobitel (l/100 km = Σ l / Σ km × 100)
--   entity_type volitelné zúžení druhu entity
--   kind        volitelné 'bar' (default) | 'trend'
--   bucket      u `trend` 'day' (default) | 'week' | 'month'
--   note_param,
--   note_agg    volitelné druhá veličina jako POZNÁMKA u sloupce — tím se
--                        spotřeba normalizuje délkou trasy, aniž by se míchala
--                        do jednoho čísla
--   date_from/date_to nebo days (default 7 u bar, 30 u trend)
--   limit       volitelné default 20, strop 100
--   unit_key    volitelné i18n klíč jednotky
--
-- ⭐ Bod bez hodnoty se NEKRESLÍ (nula by tvrdila měření). Prázdná množina
--    vrátí prázdné body a renderer ukáže „nic k zobrazení", ne osu s nulami.
--
-- Bezpečnost: SECURITY INVOKER — RLS na twin_* fail-closed.
-- Kontrakt: (jsonb) -> jsonb {data:{kind,unit_key,points[]}, provenance}.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_twin_metric_chart_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_param   text := NULLIF(btrim(COALESCE(p_params->>'param', '')), '');
  v_agg     text := lower(COALESCE(NULLIF(btrim(COALESCE(p_params->>'agg', '')), ''), 'sum'));
  v_per     text := NULLIF(btrim(COALESCE(p_params->>'per_param', '')), '');
  v_factor  numeric := COALESCE((p_params->>'factor')::numeric, 1);
  v_entity  text := NULLIF(btrim(COALESCE(p_params->>'entity_type', '')), '');
  v_kind    text := lower(COALESCE(NULLIF(btrim(COALESCE(p_params->>'kind', '')), ''), 'bar'));
  v_bucket  text := lower(COALESCE(NULLIF(btrim(COALESCE(p_params->>'bucket', '')), ''), 'day'));
  v_note    text := NULLIF(btrim(COALESCE(p_params->>'note_param', '')), '');
  v_noteagg text := COALESCE(p_params->>'note_agg', 'avg');
  v_unit    text := NULLIF(btrim(COALESCE(p_params->>'unit_key', '')), '');
  v_limit   int := LEAST(GREATEST(COALESCE((p_params->>'limit')::int, 20), 1), 100);
  v_tz      text := COALESCE(NULLIF(btrim(COALESCE(p_params->>'tz', '')), ''), 'UTC');
  v_now     timestamptz := now();
  v_from    timestamptz;
  v_to      timestamptz;
  v_points  jsonb := '[]'::jsonb;
  v_fresh   timestamptz;
  v_src     text;
BEGIN
  -- Neznámé pásmo (překlep v deklaraci bloku) NESMÍ shodit plochu: degraduje
  -- na UTC. Ověřuje se proti katalogu pásem, ne proti vlastnímu seznamu.
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_tz) THEN v_tz := 'UTC'; END IF;

  IF v_kind NOT IN ('bar', 'trend') THEN v_kind := 'bar'; END IF;
  IF v_bucket NOT IN ('day', 'week', 'month') THEN v_bucket := 'day'; END IF;

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
    v_from := v_now - make_interval(days => GREATEST(
                COALESCE((p_params->>'days')::int, CASE WHEN v_kind = 'trend' THEN 30 ELSE 7 END), 1));
  END IF;

  IF v_param IS NULL OR (v_agg = 'ratio' AND v_per IS NULL) THEN
    RETURN jsonb_build_object(
      'data', jsonb_build_object('kind', v_kind, 'points', '[]'::jsonb),
      'provenance', jsonb_build_object(
        'source_slug', 'twin-metric',
        'freshness_at', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'trace_id', 'twin-metric-chart:missing_config'));
  END IF;

  IF v_kind = 'bar' THEN
    SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'label', p.twin_label, 'value', p.value, 'note', p.note))
             ORDER BY p.value DESC NULLS LAST), '[]'::jsonb),
           max(p.last_at),
           string_agg(DISTINCT p.sources, '+' ORDER BY p.sources)
    INTO v_points, v_fresh, v_src
    FROM (
      SELECT a.twin_label, a.value, a.last_at, a.sources,
             (SELECT n.value::text FROM public.twin_param_agg(v_note, v_noteagg, v_from, v_to, v_entity) n
               WHERE n.twin_id = a.twin_id) AS note
      FROM public.twin_param_agg(v_param, v_agg, v_from, v_to, v_entity, v_per, v_factor) a
      WHERE a.value IS NOT NULL
      ORDER BY a.value DESC
      LIMIT v_limit
    ) p;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object('label', to_char(b.bucket, 'YYYY-MM-DD'), 'value', b.value)
                              ORDER BY b.bucket), '[]'::jsonb),
           max(b.last_at),
           string_agg(DISTINCT b.sources, '+' ORDER BY b.sources)
    INTO v_points, v_fresh, v_src
    FROM (
      SELECT g.bucket,
             -- Zaokrouhlení JEDNOU nad hotovou agregací (jako twin_param_agg):
             -- hodnoty jsou v jednotce parametru, a katalogový převod (s → h)
             -- dává periodická desetinná místa.
             trim_scale(round(CASE v_agg
               WHEN 'avg'   THEN g.v_avg
               WHEN 'count' THEN g.v_cnt
               WHEN 'max'   THEN g.v_max
               WHEN 'min'   THEN g.v_min
               -- Jmenovatel se počítá PO OBDOBÍCH a připojuje se spojením.
               -- Korelovaný poddotaz se tu nabízel, ale sahal by na
               -- `v.occurred_at` mimo seskupení — což PostgreSQL odmítne AŽ při
               -- plánování, tedy při prvním volání, ne při vytvoření funkce.
               WHEN 'ratio' THEN v_factor * g.v_sum / NULLIF(d.denom, 0)
               ELSE g.v_sum
             END, 2)) AS value,
             g.last_at, g.sources
      FROM (
        -- Koš = den/týden/měsíc V PÁSMU BLOKU. `date_trunc` nad timestamptz
        -- jinak seká podle pásma SPOJENÍ (u nás UTC), takže by se noční jízda
        -- počítala do předchozího dne a týden by se lámal ve 2:00 ráno.
        SELECT date_trunc(v_bucket, v.occurred_at AT TIME ZONE v_tz) AS bucket,
               sum(v.value)   AS v_sum,
               avg(v.value)   AS v_avg,
               count(*)::numeric AS v_cnt,
               max(v.value)   AS v_max,
               min(v.value)   AS v_min,
               max(v.occurred_at) AS last_at,
               string_agg(DISTINCT v.source, '+' ORDER BY v.source) AS sources
        FROM public.twin_param_values(v_param, v_from, v_to, v_entity) v
        GROUP BY 1
      ) g
      LEFT JOIN (
        SELECT date_trunc(v_bucket, w.occurred_at AT TIME ZONE v_tz) AS bucket, sum(w.value) AS denom
        FROM public.twin_param_values(v_per, v_from, v_to, v_entity) w
        GROUP BY 1
      ) d ON d.bucket = g.bucket
      ORDER BY g.bucket DESC
      LIMIT v_limit
    ) b
    WHERE b.value IS NOT NULL;
  END IF;

  -- `data` DOSLOVNĚ: klíče jsou kontrakt bloku a brána block-data-keys-fit-contract
  -- je čte ze zdroje (obal jsonb_strip_nulls pro ni byl nečitelný). NULL tu smí
  -- být jen volitelný unit_key — kontrakt chartu ho zná jen jako řetězec, takže
  -- bez jednotky klíč odchází celý. Body nully nenesou (bar je čistí po bodech,
  -- trend filtruje b.value IS NOT NULL), `kind` je vždy vyplněný.
  RETURN jsonb_build_object(
    'data', jsonb_build_object(
      'kind', v_kind,
      'unit_key', v_unit,
      'points', v_points) - CASE WHEN v_unit IS NULL THEN 'unit_key' ELSE '' END,
    'provenance', jsonb_build_object(
      'source_slug', COALESCE(v_src, 'twin-metric'),
      'freshness_at', to_char(COALESCE(v_fresh, v_now) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id', 'twin-metric-chart:' || v_param || ':' || v_kind
                  || CASE WHEN v_fresh IS NULL THEN ':no_data' ELSE '' END));
END;
$$;

COMMENT ON FUNCTION public.get_twin_metric_chart_block(jsonb) IS
  'Generický graf nad dvojčaty: bar = veličina po entitách, trend = po obdobích; parametr a agregace z konfigurace bloku, bod bez hodnoty se nekreslí.';

REVOKE ALL ON FUNCTION public.get_twin_metric_chart_block(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_twin_metric_chart_block(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_twin_metric_chart_block(jsonb) TO service_role;

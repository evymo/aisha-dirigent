-- ============================================================================
-- Source of Truth: get_audience_view_chart_block
-- Popis: GENERICKÝ 'chart' blok nad ADMIN pohledy publika. Dvojče
--        get_audience_view_table_block — tytéž dvě pojistky, tentýž jmenný
--        prostor, jen jiný tvar dat: body grafu místo řádků tabulky.
--
-- Nahrazuje Appsmith stránky "Tier Funnel" a "Campaign Performance"
-- (appsmith-templates/audience/) plochou extranetu.
--
-- Konfigurace (p_params):
--   view       POVINNÉ  jméno pohledu, MUSÍ odpovídat ^audience_admin_[a-z0-9_]+_v$
--   label_src  POVINNÉ  sloupec pohledu → ChartPoint.label
--   value_src  POVINNÉ  sloupec pohledu → ChartPoint.value (číslo)
--   kind       volitelné 'bar' (default) | 'trend' | 'donut' — UZAVŘENÁ množina,
--                        protože jmenuje renderer; neznámá hodnota => 'bar'
--   pct_src    volitelné sloupec 0–100 → ChartPoint.pct
--   note_src   volitelné sloupec → ChartPoint.note
--   limit      volitelné default 20, strop 100
--   order_by   volitelné jméno sloupce; MUSÍ být jeden z *_src výše
--   order_dir  volitelné 'asc' | 'desc' (default 'desc')
--   unit_key   volitelné i18n klíč jednotky
--
-- ⛔ NULA NENÍ NEMĚŘENO. `value` je v kontraktu číslo; řádek, jehož hodnota se
-- na číslo přeložit nedá, se do bodů NEZAHRNE. Dosadit nulu by tvrdilo měření,
-- které nikdo neprovedl — týž důvod, proč KpiTileBlock.value smí být null.
--
-- Bezpečnost: viz get_audience_view_table_block — is_admin_or_staff() jako
-- autorizace a jmenný prostor `audience_admin_*_v` jako druhá, nezávislá
-- pojistka. Klientské parametry v get_block_data PŘEBÍJEJÍ konfiguraci bloku,
-- takže konfigurace hranicí není a být nemůže.
--
-- Poctivá degradace: chybějící konfigurace i nedostatek práv vracejí prázdné
-- body s důvodem v provenance.trace_id, nikdy výjimku.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_audience_view_chart_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_view      text  := nullif(btrim(coalesce(p_params->>'view', '')), '');
  v_label     text  := nullif(btrim(coalesce(p_params->>'label_src', '')), '');
  v_value     text  := nullif(btrim(coalesce(p_params->>'value_src', '')), '');
  v_pct       text  := nullif(btrim(coalesce(p_params->>'pct_src', '')), '');
  v_note      text  := nullif(btrim(coalesce(p_params->>'note_src', '')), '');
  v_kind      text  := lower(coalesce(p_params->>'kind', 'bar'));
  v_limit     int   := least(greatest(coalesce((p_params->>'limit')::int, 20), 1), 100);
  v_order_by  text  := nullif(btrim(coalesce(p_params->>'order_by', '')), '');
  v_order_dir text  := lower(coalesce(p_params->>'order_dir', 'desc'));
  v_now       timestamptz := now();
  v_raw       jsonb;
  v_points    jsonb := '[]'::jsonb;
  v_order_sql text  := '';
BEGIN
  -- 'kind' jmenuje RENDERER, takže je uzavřený. Neznámá hodnota nesmí blok
  -- shodit ani ho nechat zmizet — degraduje na 'bar', který umí každý řez dat.
  IF v_kind NOT IN ('bar', 'trend', 'donut') THEN
    v_kind := 'bar';
  END IF;

  IF NOT public.is_admin_or_staff() THEN
    RETURN jsonb_build_object(
      'data', jsonb_build_object('kind', v_kind, 'points', '[]'::jsonb),
      'provenance', jsonb_build_object(
        'source_slug', 'audience',
        'trace_id', 'audience-chart:unauthorized',
        'freshness_at', v_now));
  END IF;

  IF v_view IS NULL
     OR v_view !~ '^audience_admin_[a-z0-9_]+_v$'
     OR to_regclass('public.' || quote_ident(v_view)) IS NULL
     OR v_label IS NULL
     OR v_value IS NULL
  THEN
    RETURN jsonb_build_object(
      'data', jsonb_build_object('kind', v_kind, 'points', '[]'::jsonb),
      'provenance', jsonb_build_object(
        'source_slug', 'audience',
        'trace_id', 'audience-chart:missing_config',
        'freshness_at', v_now));
  END IF;

  -- Řazení smí ukázat jen na sloupec, který už je v konfiguraci deklarovaný —
  -- jinak by `order_by` byl druhá cesta, jak do dotazu propašovat identifikátor.
  IF v_order_by IS NOT NULL
     AND v_order_by IN (v_label, v_value, coalesce(v_pct, v_label), coalesce(v_note, v_label))
  THEN
    v_order_sql := format('order by %I %s nulls last',
                          v_order_by,
                          CASE WHEN v_order_dir = 'asc' THEN 'asc' ELSE 'desc' END);
  END IF;

  EXECUTE format(
    'select coalesce(jsonb_agg(to_jsonb(t) order by t.__rn), ''[]''::jsonb)'
    || ' from (select v.*, row_number() over (%s) as __rn from public.%I v limit %s) t',
    v_order_sql, v_view, v_limit)
  INTO v_raw;

  SELECT coalesce(jsonb_agg(pt ORDER BY ord), '[]'::jsonb)
    INTO v_points
  FROM (
    SELECT (row_value->>'__rn')::bigint AS ord,
           jsonb_strip_nulls(jsonb_build_object(
             'label', coalesce(row_value->>v_label, ''),
             'value', to_jsonb(nullif(row_value->>v_value, '')::numeric),
             'pct',   CASE WHEN v_pct  IS NULL THEN NULL
                           ELSE to_jsonb(nullif(row_value->>v_pct, '')::numeric) END,
             'note',  CASE WHEN v_note IS NULL THEN NULL
                           ELSE to_jsonb(nullif(row_value->>v_note, '')) END)) AS pt
    FROM jsonb_array_elements(v_raw) AS row_value
    -- Řádek bez čitelné hodnoty se vynechá — viz „nula není neměřeno" výše.
    WHERE nullif(row_value->>v_value, '') IS NOT NULL
      AND (row_value->>v_value) ~ '^-?[0-9]+(\.[0-9]+)?$'
  ) s;

  -- ⛔ KLÍČE `data` JSOU DOSLOVA VE ZDROJI (naměřeno 2026-09-03, brána
  -- block-data-keys-fit-contract s instančním overlayem). Dřívější
  -- `jsonb_strip_nulls(jsonb_build_object(…))` měla jediný účel — nevydat
  -- `unit_key: null` (kontrakt zná jen string) — jenže bráně tím schovala
  -- klíče; ta pak nemohla dosvědčit, že blok vydává jen to, co kontrakt zná.
  -- Volitelný klíč se přidá jen když má hodnotu; povinné jsou vidět doslova.
  RETURN jsonb_build_object(
    'data', jsonb_build_object(
      'kind', v_kind,
      'points', v_points)
      || CASE
           WHEN nullif(btrim(coalesce(p_params->>'unit_key', '')), '') IS NULL THEN '{}'::jsonb
           ELSE jsonb_build_object('unit_key', btrim(p_params->>'unit_key'))
         END,
    'provenance', jsonb_build_object(
      'source_slug', v_view,
      'trace_id', 'audience-chart:' || v_view,
      'freshness_at', v_now));
END;
$$;

REVOKE ALL ON FUNCTION public.get_audience_view_chart_block(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_audience_view_chart_block(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_audience_view_chart_block(jsonb) TO service_role;

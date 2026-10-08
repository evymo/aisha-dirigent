-- ============================================================================
-- Source of Truth: get_audience_view_kpi_block
-- Popis: GENERICKÝ 'kpi_tile' blok nad ADMIN pohledy publika. Třetí sourozenec
--        get_audience_view_{table,chart}_block — tytéž dvě pojistky, tentýž
--        jmenný prostor, jen jiný tvar: JEDNO číslo místo řádků nebo bodů.
--
-- ⛔ PROČ VZNIKL (naměřeno 2026-09-07): čísla o komunitě se dala spočítat
-- (agregační pohledy existují) i přinést zvenčí (federační adaptér), ale na
-- ploše je nebylo KUDY ukázat — žádná maska nad jedním číslem neměla producenta.
-- Statistika, kterou nikdo nevidí, je stejně užitečná jako statistika, která
-- neexistuje.
--
-- Konfigurace (p_params):
--   view       POVINNÉ  jméno pohledu, MUSÍ odpovídat ^audience_admin_[a-z0-9_]+_v$
--   value_src  POVINNÉ  sloupec pohledu → data.value
--   agg        volitelné 'count' (default) | 'sum' | 'max' | 'first'
--                        UZAVŘENÁ množina; neznámá hodnota => 'count'
--   where_src  volitelné sloupec pro filtr
--   where_val  volitelné hodnota filtru (rovnost, porovnává se jako text)
--   unit_key   volitelné i18n klíč jednotky
--   state      volitelné 'ok' | 'warning' | 'loss' — STAV JE DEKLARACE, ne odhad:
--                        funkce si ho nedovodí z hodnoty, protože neví, jestli je
--                        větší lepší (počet členů) nebo horší (počet po termínu)
--
-- ⭐ `value: null` = NEMĚŘENO a je to PLATNÁ odpověď (viz maska kpi_tile). Nula by
-- tvrdila měření, které nikdo neprovedl — u „kolik jich přišlo ze zdroje" je to
-- rozdíl mezi „zdroj mlčí" a „zdroj říká nula". Prázdná konfigurace i chybějící
-- právo proto vracejí null, ne 0.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_audience_view_kpi_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_view      text := nullif(btrim(coalesce(p_params->>'view', '')), '');
  v_value_src text := nullif(btrim(coalesce(p_params->>'value_src', '')), '');
  v_agg       text := lower(coalesce(nullif(btrim(coalesce(p_params->>'agg','')),''), 'count'));
  v_where_src text := nullif(btrim(coalesce(p_params->>'where_src', '')), '');
  v_where_val text := p_params->>'where_val';
  v_unit_key  text := nullif(btrim(coalesce(p_params->>'unit_key', '')), '');
  v_state     text := lower(coalesce(nullif(btrim(coalesce(p_params->>'state','')),''), 'ok'));
  v_now       timestamptz := now();
  v_value     numeric;
  v_sql       text;
BEGIN
  -- Neznámá hodnota degraduje na výchozí místo pádu: nová deklarace nesmí
  -- shodit starší databázi (táž úvaha jako u `kind` v grafu a `op` ve filtru).
  IF v_agg NOT IN ('count','sum','max','first') THEN v_agg := 'count'; END IF;
  IF v_state NOT IN ('ok','warning','loss')     THEN v_state := 'ok';   END IF;

  -- Prázdná odpověď se skládá na jednom místě, aby se všechny důvody vracely
  -- v témž tvaru — renderer nesmí poznat rozdíl mezi „nemáš právo" a „nic tu
  -- není". Důvod nese trace_id, protože obálka bloku `error` nezná.
  IF NOT public.is_admin_or_staff() THEN
    RETURN jsonb_build_object(
      'data', jsonb_build_object('value', NULL),
      'provenance', jsonb_build_object('source_slug', 'audience',
        'trace_id', 'audience-kpi:unauthorized', 'freshness_at', v_now));
  END IF;

  IF v_view IS NULL OR v_value_src IS NULL
     OR v_view !~ '^audience_admin_[a-z0-9_]+_v$'
     OR to_regclass('public.' || quote_ident(v_view)) IS NULL
  THEN
    RETURN jsonb_build_object(
      'data', jsonb_build_object('value', NULL),
      'provenance', jsonb_build_object('source_slug', coalesce(v_view, 'audience'),
        'trace_id', 'audience-kpi:missing_config', 'freshness_at', v_now));
  END IF;

  -- Identifikátory přes %I, hodnota filtru přes %L — jmenný prostor pohledů
  -- hlídá `view`, ale sloupec i hodnota jsou pořád VSTUP.
  v_sql := format(
    CASE v_agg
      WHEN 'sum'   THEN 'select sum(%1$I)::numeric from public.%2$I'
      WHEN 'max'   THEN 'select max(%1$I)::numeric from public.%2$I'
      WHEN 'first' THEN 'select (%1$I)::numeric from public.%2$I'
      ELSE              'select count(%1$I)::numeric from public.%2$I'
    END, v_value_src, v_view);

  IF v_where_src IS NOT NULL THEN
    v_sql := v_sql || format(' where %I::text = %L', v_where_src, coalesce(v_where_val, ''));
  END IF;
  IF v_agg = 'first' THEN v_sql := v_sql || ' limit 1'; END IF;

  BEGIN
    EXECUTE v_sql INTO v_value;
  EXCEPTION WHEN undefined_column OR invalid_text_representation THEN
    -- Špatně pojmenovaný sloupec je vada KONFIGURACE, ne důvod shodit plochu.
    RETURN jsonb_build_object(
      'data', jsonb_build_object('value', NULL),
      'provenance', jsonb_build_object('source_slug', v_view,
        'trace_id', 'audience-kpi:bad_config', 'freshness_at', v_now));
  END;

  RETURN jsonb_build_object(
    'data', jsonb_strip_nulls(jsonb_build_object(
      'value', v_value,
      'unit_key', v_unit_key,
      'state', v_state)),
    'provenance', jsonb_build_object(
      'source_slug', v_view,
      'trace_id', 'audience-kpi:' || v_agg,
      'freshness_at', v_now));
END;
$$;

REVOKE ALL ON FUNCTION public.get_audience_view_kpi_block(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_audience_view_kpi_block(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_audience_view_kpi_block(jsonb) TO service_role;

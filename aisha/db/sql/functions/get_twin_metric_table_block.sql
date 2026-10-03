-- ============================================================================
-- Source of Truth: get_twin_metric_table_block
-- Popis: GENERICKÁ tabulka „entita × několik veličin" nad substrátem dvojčat
--        (maska `table`). Sloupce jsou KONFIGURACE bloku: každý nese kód
--        parametru z katalogu a agregaci; volitelně druhý parametr pro poměr
--        nebo pro rozdíl. Tím se z jedné funkce skládá palivová bilance
--        (natankováno − spotřeba = Δ), spotřeba proti délce trasy i seznam
--        odstavených vozidel — bez řádku kódu na doménu.
--
-- Konfigurace (p_params):
--   entity_type POVINNÉ  druh entity (řádky tabulky)
--   columns     POVINNÉ  [{key, label_key, param, agg?, per_param?, factor?,
--                          minus_param?, minus_agg?, numeric?, as?}]
--                        `as:"last_at"` udělá ze sloupce ČAS poslední hodnoty
--                        parametru („kdy naposledy jel"), ne její velikost
--                        key ~ ^[a-z][a-z0-9_]*$; `label` je vyhrazený klíč
--   date_from,
--   date_to     volitelné absolutní okno; jinak `days` (default 7)
--   sort        volitelné {key, dir asc|desc} — jinak podle názvu entity
--   limit       volitelné default 50, strop 200
--   only_with_data volitelné true = entity bez jediné hodnoty se nevypíšou
--
-- ⭐ Prázdná buňka zůstává NULL (renderer kreslí „—"). Nula by u vozu bez dat
--    tvrdila, že nenatankoval — přesně ta vada, kterou měla palivová bilance.
--    Řádek nese `id` dvojčete, takže z tabulky vede proklik na kartu.
--
-- Bezpečnost: SECURITY INVOKER — RLS na twin_* fail-closed.
-- Kontrakt: (jsonb) -> jsonb {data:{row_kind,columns[],rows[]}, provenance}.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_twin_metric_table_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entity  text := NULLIF(btrim(COALESCE(p_params->>'entity_type', '')), '');
  v_cols    jsonb := COALESCE(p_params->'columns', '[]'::jsonb);
  v_limit   int := LEAST(GREATEST(COALESCE((p_params->>'limit')::int, 50), 1), 200);
  v_sortkey text := NULLIF(btrim(COALESCE(p_params->'sort'->>'key', '')), '');
  v_sortdir text := lower(COALESCE(NULLIF(btrim(COALESCE(p_params->'sort'->>'dir', '')), ''), 'desc'));
  v_only    boolean := COALESCE((p_params->>'only_with_data')::boolean, false);
  v_tz      text := COALESCE(NULLIF(btrim(COALESCE(p_params->>'tz', '')), ''), 'UTC');
  v_now     timestamptz := now();
  v_from    timestamptz;
  v_to      timestamptz;
  v_col     jsonb;
  v_key     text;
  v_vals    jsonb := '{}'::jsonb;   -- klíč sloupce → {twin_id: hodnota}
  v_one     jsonb;
  v_last    jsonb;
  v_asof    boolean;
  v_minus   jsonb;
  v_cols_out jsonb := jsonb_build_array(
    jsonb_build_object('key', 'label', 'label_key', 'app.twins.col.label', 'align', 'left'));
  v_rows    jsonb := '[]'::jsonb;
  v_fresh   timestamptz;
  v_src     text;
BEGIN
  -- Neznámé pásmo (překlep v deklaraci bloku) NESMÍ shodit plochu: degraduje
  -- na UTC. Ověřuje se proti katalogu pásem, ne proti vlastnímu seznamu.
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_tz) THEN v_tz := 'UTC'; END IF;

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

  -- Poctivá degradace: chybějící konfigurace vrátí PRÁZDNOU tabulku v platném
  -- tvaru, ne výjimku. Blok se přizná v provenance a plocha drží (vzor
  -- get_twin_events_table_block).
  IF v_entity IS NULL OR jsonb_typeof(v_cols) <> 'array' OR jsonb_array_length(v_cols) = 0 THEN
    RETURN jsonb_build_object(
      'data', jsonb_build_object('row_kind', 'twin', 'columns', v_cols_out, 'rows', '[]'::jsonb),
      'provenance', jsonb_build_object(
        'source_slug', 'twin-metric',
        'freshness_at', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'trace_id', 'twin-metric-table:missing_config'));
  END IF;

  FOR v_col IN SELECT * FROM jsonb_array_elements(v_cols) LOOP
    v_key := v_col->>'key';
    CONTINUE WHEN v_key IS NULL OR v_key !~ '^[a-z][a-z0-9_]*$' OR v_key = 'label'
              OR NULLIF(btrim(COALESCE(v_col->>'param', '')), '') IS NULL;

    v_asof := lower(COALESCE(v_col->>'as', 'value')) = 'last_at';

    -- Jedním průchodem obojí: hodnota i ČAS poslední hodnoty. Sloupec „kdy
    -- naposledy" tak nestojí na druhém dotazu, který by se mohl rozejít.
    SELECT jsonb_object_agg(a.twin_id::text, a.value) FILTER (WHERE a.value IS NOT NULL),
           jsonb_object_agg(a.twin_id::text,
                            to_char(a.last_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
             FILTER (WHERE a.last_at IS NOT NULL),
           max(a.last_at),
           string_agg(DISTINCT a.sources, '+' ORDER BY a.sources)
    INTO v_one, v_last, v_fresh, v_src
    FROM public.twin_param_agg(
           v_col->>'param',
           COALESCE(v_col->>'agg', 'sum'),
           v_from, v_to, v_entity,
           NULLIF(btrim(COALESCE(v_col->>'per_param', '')), ''),
           COALESCE((v_col->>'factor')::numeric, 1)) a;

    IF v_asof THEN v_one := v_last; END IF;

    -- Rozdíl dvou veličin (Δ nádrž = natankováno − spotřeba) je pořád JEDEN
    -- sloupec: odečítá se až tady, aby obě strany šly i samostatně.
    IF NULLIF(btrim(COALESCE(v_col->>'minus_param', '')), '') IS NOT NULL THEN
      SELECT jsonb_object_agg(a.twin_id::text, a.value) FILTER (WHERE a.value IS NOT NULL)
      INTO v_minus
      FROM public.twin_param_agg(
             v_col->>'minus_param',
             COALESCE(v_col->>'minus_agg', 'sum'),
             v_from, v_to, v_entity) a;

      SELECT jsonb_object_agg(k, val) INTO v_one
      FROM (
        SELECT k,
               trim_scale(round(COALESCE((COALESCE(v_one, '{}'::jsonb)->>k)::numeric, 0)
                     - COALESCE((COALESCE(v_minus, '{}'::jsonb)->>k)::numeric, 0), 2)) AS val
        FROM (
          SELECT jsonb_object_keys(COALESCE(v_one, '{}'::jsonb)) AS k
          UNION
          SELECT jsonb_object_keys(COALESCE(v_minus, '{}'::jsonb))
        ) ks
      ) d;
    END IF;

    v_vals := v_vals || jsonb_build_object(v_key, COALESCE(v_one, '{}'::jsonb));
    v_cols_out := v_cols_out || jsonb_build_array(jsonb_build_object(
      'key', v_key,
      'label_key', COALESCE(v_col->>'label_key', 'app.twins.col.' || v_key),
      'align', CASE WHEN COALESCE((v_col->>'numeric')::boolean, NOT v_asof) THEN 'right' ELSE 'left' END));
  END LOOP;

  -- Řádky se skládají nad REGISTREM entit, ne nad naměřenými hodnotami: vůz
  -- bez jediné hodnoty je „neměřeno", a to je jiná informace než „nebyl".
  SELECT COALESCE(jsonb_agg(r ORDER BY r_sort_num, r_label), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      jsonb_build_object('id', t.id::text, 'label', t.label)
        || COALESCE((SELECT jsonb_object_agg(c.key, (v_vals->(c.key))->(t.id::text))
                     FROM jsonb_object_keys(v_vals) c(key)), '{}'::jsonb) AS r,
      t.label AS r_label,
      -- Řadit jde jen podle ČÍSELNÉHO sloupce; text („kdy naposledy") by
      -- přetypování shodil. Neplatný klíč = řazení podle názvu, ne pád.
      CASE WHEN v_sortkey IS NULL
             OR ((v_vals->(v_sortkey))->>(t.id::text)) !~ '^-?[0-9]+(\.[0-9]+)?$' THEN NULL
           WHEN v_sortdir = 'asc'
             THEN  ((v_vals->(v_sortkey))->>(t.id::text))::numeric
           ELSE   -((v_vals->(v_sortkey))->>(t.id::text))::numeric
      END AS r_sort_num
    FROM public.twin_entities t
    WHERE t.entity_type = v_entity
      AND t.status = 'active'
      AND (NOT v_only OR EXISTS (
            SELECT 1 FROM jsonb_object_keys(v_vals) c(key)
            WHERE (v_vals->(c.key)) ? (t.id::text)))
    LIMIT v_limit
  ) s;

  RETURN jsonb_build_object(
    'data', jsonb_build_object('row_kind', 'twin', 'columns', v_cols_out, 'rows', v_rows),
    'provenance', jsonb_build_object(
      'source_slug', COALESCE(v_src, 'twin-metric'),
      'freshness_at', to_char(COALESCE(v_fresh, v_now) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id', 'twin-metric-table:' || v_entity || CASE WHEN v_fresh IS NULL THEN ':no_data' ELSE '' END));
END;
$$;

COMMENT ON FUNCTION public.get_twin_metric_table_block(jsonb) IS
  'Generická tabulka entita × veličiny nad dvojčaty; sloupce jsou konfigurace bloku (parametr z katalogu, agregace, poměr, rozdíl). Prázdná buňka zůstává NULL.';

REVOKE ALL ON FUNCTION public.get_twin_metric_table_block(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_twin_metric_table_block(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_twin_metric_table_block(jsonb) TO service_role;

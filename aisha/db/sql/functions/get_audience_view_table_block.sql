-- ============================================================================
-- Source of Truth: get_audience_view_table_block
-- Popis: GENERICKÝ 'table' blok nad ADMIN pohledy publika. Který pohled a jaké
--        sloupce, říká KONFIGURACE bloku (surface_blocks.source_params, tedy
--        řádek v instančním overlayi) — v kódu není žádná doménová ani
--        instanční hodnota. Táž stavba jako get_twin_events_table_block, jen
--        substrátem nejsou twin události, ale `audience_admin_*_v`.
--
-- Nahrazuje Appsmith stránky "Contact Directory" a "Cohort Manager"
-- (appsmith-templates/audience/) plochou extranetu: tytéž pohledy, tentýž
-- allowlist, ale povrch, který je project-specific a měřitelný.
--
-- Konfigurace (p_params):
--   view      POVINNÉ  jméno pohledu, MUSÍ odpovídat ^audience_admin_[a-z0-9_]+_v$
--   columns   POVINNÉ  pole [{key, label | label_key, src, numeric?}]
--                      src = jméno sloupce pohledu
--   limit     volitelné  default 50, strop 200
--   order_by  volitelné  jméno sloupce; MUSÍ být mezi `src` deklarovaných columns
--   order_dir volitelné  'asc' | 'desc' (default 'desc')
--
-- ── BEZPEČNOST: DVĚ NEZÁVISLÉ POJISTKY ─────────────────────────────────────
-- ⛔ PROČ VÍC NEŽ „je přihlášen". Dispatcher get_block_data slučuje parametry
-- jako `source_params || p_params` — KLIENTSKÉ VYHRÁVAJÍ. Konfigurace bloku
-- tedy NENÍ hranice: volající si `view` přepíše. A `surface_layouts.audience`
-- taky ne — ta filtruje jen list_surface_sections, tedy co se VYPÍŠE; kdo zná
-- block_slug, zavolá get_block_data přímo. (Naměřeno 2026-08-25 na
-- get_twin_events_table_block, který je SECURITY DEFINER „napříč RLS" a jedinou
-- pojistku má `auth.uid() is null` — tedy přihlášen, ne oprávněn.)
--
-- U kontaktních údajů publika je to rozdíl mezi provozem a únikem, proto:
--   1. AUTORIZACE: is_admin_or_staff() — táž hranice, jakou drží každé
--      audience_admin_* RPC (viz audience_admin_create_followup).
--   2. JMENNÝ PROSTOR: `view` smí být jen `audience_admin_*_v`. I kdyby první
--      pojistka jednou padla, dosah je omezen na pohledy, které jsou admin
--      z konstrukce — ne na libovolnou tabulku.
-- Každá pojistka platí sama o sobě; obě dohromady jsou obrana do hloubky.
--
-- Poctivá degradace: chybějící/neplatná konfigurace i nedostatek práv vracejí
-- PRÁZDNÁ data s důvodem v provenance.trace_id — nikdy výjimku. Blok se přizná
-- místo aby zmizel (neshoda se schématem rendereru = tichý zánik bloku).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_audience_view_table_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_view      text  := nullif(btrim(coalesce(p_params->>'view', '')), '');
  v_cols      jsonb := coalesce(p_params->'columns', '[]'::jsonb);
  v_limit     int   := least(greatest(coalesce((p_params->>'limit')::int, 50), 1), 200);
  v_order_by  text  := nullif(btrim(coalesce(p_params->>'order_by', '')), '');
  v_order_dir text  := lower(coalesce(p_params->>'order_dir', 'desc'));
  v_now       timestamptz := now();
  v_raw       jsonb;
  v_rows      jsonb;
  v_order_sql text  := '';
  -- ⭐ (K3, 2026-09-05) řádek jako ZÁZNAM a filtr jako DATA:
  --   row_kind  volitelné  druh záznamu, který řádek představuje (např. 'twin');
  --                        shell podle něj vybere čtečku detailu (detail_by_kind)
  --   id_src    volitelné  sloupec pohledu s identitou řádku → rows[].id
  --   filters   volitelné  [{src, param, op?}] — porovnání sloupce pohledu s
  --                        hodnotou parametru; chybí-li parametr, filtr se
  --                        neuplatní. Hodnota jde do dotazu jako LITERÁL (%L),
  --                        sloupec jako identifikátor (%I) — nic z klienta se
  --                        neskládá do SQL jako text. U restricted bloku
  --                        parametr dorazí jen přes deklaraci client_params
  --                        (get_block_data).
  --                        `op` je OPERÁTOR, tedy DRUH porovnání, ne jméno věci:
  --                          'eq'       (výchozí) rovnost nad textem sloupce
  --                          'contains' hodnota je PRVKEM sloupce s více
  --                                     hodnotami (pole) — bez něj by osa nad
  --                                     štítky či vazbami jen zdobila lištu
  --                                     a nic nefiltrovala (K5, 2026-09-06).
  --                        Neznámý operátor degraduje na 'eq'; nová deklarace
  --                        tak nikdy neshodí starší databázi.
  v_row_kind  text  := nullif(btrim(coalesce(p_params->>'row_kind', '')), '');
  v_id_src    text  := nullif(btrim(coalesce(p_params->>'id_src', '')), '');
  v_filters   jsonb := CASE WHEN jsonb_typeof(p_params->'filters') = 'array'
                            THEN p_params->'filters' ELSE '[]'::jsonb END;
  v_where_sql text  := '';
  v_f         jsonb;
  v_fval      text;
BEGIN
  IF v_row_kind IS NOT NULL AND v_row_kind !~ '^[a-z_][a-z0-9_]*$' THEN v_row_kind := NULL; END IF;
  IF v_id_src   IS NOT NULL AND v_id_src   !~ '^[a-z_][a-z0-9_]*$' THEN v_id_src   := NULL; END IF;
  FOR v_f IN SELECT * FROM jsonb_array_elements(v_filters) LOOP
    v_fval := nullif(btrim(coalesce(p_params->>(v_f->>'param'), '')), '');
    IF v_fval IS NOT NULL
       AND coalesce(v_f->>'src', '') ~ '^[a-z_][a-z0-9_]*$'
       AND length(v_fval) <= 200 THEN
      IF coalesce(v_f->>'op', 'eq') = 'contains' THEN
        -- Sloupec s více hodnotami: ptáme se na PRVEK, ne na rovnost celku.
        -- `::text[]` je explicitní, aby se pole čísel nebo enumů chovalo stejně.
        v_where_sql := v_where_sql || format(' and %L = any(v.%I::text[])', v_fval, v_f->>'src');
      ELSE
        v_where_sql := v_where_sql || format(' and v.%I::text = %L', v_f->>'src', v_fval);
      END IF;
    END IF;
  END LOOP;
  -- Prázdná odpověď se skládá na jednom místě, aby se všechny důvody vracely
  -- v témž tvaru — renderer nesmí poznat rozdíl mezi „nemáš právo" a „nic tu
  -- není". Důvod nese trace_id, protože `error` obálka bloku nezná.
  v_rows := '[]'::jsonb;

  IF NOT public.is_admin_or_staff() THEN
    RETURN jsonb_build_object(
      'data', jsonb_build_object('columns', '[]'::jsonb, 'rows', v_rows),
      'provenance', jsonb_build_object(
        'source_slug', 'audience',
        'trace_id', 'audience-table:unauthorized',
        'freshness_at', v_now));
  END IF;

  IF v_view IS NULL
     OR v_view !~ '^audience_admin_[a-z0-9_]+_v$'
     OR to_regclass('public.' || quote_ident(v_view)) IS NULL
     OR jsonb_array_length(v_cols) = 0
  THEN
    RETURN jsonb_build_object(
      'data', jsonb_build_object('columns', '[]'::jsonb, 'rows', v_rows),
      'provenance', jsonb_build_object(
        'source_slug', 'audience',
        'trace_id', 'audience-table:missing_config',
        'freshness_at', v_now));
  END IF;

  -- Řazení je taky vstup, takže se taky ověřuje: sloupec MUSÍ být mezi
  -- deklarovanými `src`. Bez toho by `order_by` byl druhá cesta, jak do dotazu
  -- dostat cizí identifikátor — jmenný prostor pohledů by hlídal `view`, ale
  -- tudy by prošlo cokoli.
  IF v_order_by IS NOT NULL
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_cols) c WHERE c->>'src' = v_order_by)
  THEN
    v_order_sql := format(' order by %I %s nulls last',
                          v_order_by,
                          CASE WHEN v_order_dir = 'asc' THEN 'asc' ELSE 'desc' END);
  END IF;

  -- Celé řádky se načtou jako jsonb a promítnou se AŽ POTOM. Dynamický je tak
  -- jen identifikátor pohledu a ověřený sloupec řazení — ne seznam sloupců.
  EXECUTE format(
    'select coalesce(jsonb_agg(to_jsonb(t) order by t.__rn), ''[]''::jsonb)'
    || ' from (select v.*, row_number() over (%s) as __rn from public.%I v where true%s limit %s) t',
    CASE WHEN v_order_sql = '' THEN '' ELSE substr(v_order_sql, 2) END,
    v_view, v_where_sql, v_limit)
  INTO v_raw;

  SELECT coalesce(jsonb_agg(projected ORDER BY ord), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT (row_value->>'__rn')::bigint AS ord,
           (SELECT jsonb_object_agg(
                     col->>'key',
                     CASE
                       WHEN (col->>'numeric')::boolean IS TRUE
                         THEN to_jsonb(nullif(row_value->>(col->>'src'), '')::numeric)
                       ELSE coalesce(row_value->(col->>'src'), 'null'::jsonb)
                     END)
              FROM jsonb_array_elements(v_cols) col)
           || CASE WHEN v_id_src IS NOT NULL AND nullif(row_value->>v_id_src, '') IS NOT NULL
                   THEN jsonb_build_object('id', row_value->>v_id_src)
                   ELSE '{}'::jsonb END AS projected
    FROM jsonb_array_elements(v_raw) AS row_value
  ) s;

  RETURN jsonb_build_object(
    'data', jsonb_build_object(
      'columns', (SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                    'key', c->>'key', 'label', c->>'label', 'label_key', c->>'label_key')))
                  FROM jsonb_array_elements(v_cols) c),
      'rows', v_rows)
      || CASE WHEN v_row_kind IS NOT NULL THEN jsonb_build_object('row_kind', v_row_kind)
              ELSE '{}'::jsonb END,
    'provenance', jsonb_build_object(
      'source_slug', v_view,
      'trace_id', 'audience-table:' || v_view,
      'freshness_at', v_now));
END;
$$;

-- Grants podle kontraktu get_block_data: nikdy anon. Autorizaci uvnitř drží
-- is_admin_or_staff(), takže `authenticated` je tu vstupenka do funkce, ne
-- k datům.
REVOKE ALL ON FUNCTION public.get_audience_view_table_block(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_audience_view_table_block(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_audience_view_table_block(jsonb) TO service_role;

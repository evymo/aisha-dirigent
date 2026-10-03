-- ============================================================================
-- Source of Truth: get_audience_view_timeline_block
-- Popis: GENERICKÝ 'timeline' blok nad ADMIN pohledy publika (ADR-003, K3):
--   jeden řádek pohledu = jedna položka osy. Který pohled, který sloupec je
--   „kdy" a který „co", říká konfigurace; koho osa ukazuje, říká filtr
--   z klientského parametru (u restricted bloku jen přes `client_params`).
--   Tytéž dvě pojistky jako sesterské bloky: is_admin_or_staff() + jmenný
--   prostor `audience_admin_*_v`.
--
-- Konfigurace (p_params):
--   view          POVINNÉ  ^audience_admin_[a-z0-9_]+_v$
--   at_src        POVINNÉ  sloupec s časem položky (timestamptz)
--   label_src     volitelné sloupec s textem položky
--   label_key_src volitelné sloupec s i18n klíčem položky (přednost před textem)
--   state_src     volitelné sloupec se stavem; propustí se jen ok|warning|loss
--   kind_src      volitelné sloupec s DRUHEM položky (email / meeting / …).
--                 Projde jen hodnota tvaru štítku (^[a-z][a-z0-9_-]{0,39}$), tedy
--                 strojová hodnota ze zdroje — NE obsah. Kdo sem omylem namíří
--                 sloupec s textem, dostane prázdno, ne odstavec v odznaku.
--   filters       volitelné [{src, param}] — rovnost sloupce s hodnotou parametru
--   limit         volitelné default 50, strop 200
--   order_dir     volitelné 'asc' | 'desc' (default 'desc' — nejnovější nahoře)
--
-- Poctivá degradace: prázdné `items` s důvodem v provenance.trace_id, nikdy výjimka.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_audience_view_timeline_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_view      text  := nullif(btrim(coalesce(p_params->>'view', '')), '');
  v_at        text  := nullif(btrim(coalesce(p_params->>'at_src', '')), '');
  v_label     text  := nullif(btrim(coalesce(p_params->>'label_src', '')), '');
  v_label_key text  := nullif(btrim(coalesce(p_params->>'label_key_src', '')), '');
  v_state     text  := nullif(btrim(coalesce(p_params->>'state_src', '')), '');
  v_kind      text  := nullif(btrim(coalesce(p_params->>'kind_src', '')), '');
  v_filters   jsonb := CASE WHEN jsonb_typeof(p_params->'filters') = 'array' THEN p_params->'filters' ELSE '[]'::jsonb END;
  v_limit     int   := least(greatest(coalesce((p_params->>'limit')::int, 50), 1), 200);
  v_dir       text  := CASE WHEN lower(coalesce(p_params->>'order_dir', 'desc')) = 'asc' THEN 'asc' ELSE 'desc' END;
  v_where_sql text  := '';
  v_f         jsonb;
  v_fval      text;
  v_raw       jsonb;
  v_now       timestamptz := now();
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RETURN jsonb_build_object(
      'data', jsonb_build_object('items', '[]'::jsonb),
      'provenance', jsonb_build_object('source_slug', coalesce(v_view, 'audience'),
                                       'trace_id', 'audience-timeline:unauthorized', 'freshness_at', v_now));
  END IF;
  IF v_view IS NULL OR v_view !~ '^audience_admin_[a-z0-9_]+_v$'
     OR to_regclass('public.' || quote_ident(v_view)) IS NULL
     OR v_at IS NULL OR v_at !~ '^[a-z_][a-z0-9_]*$'
     OR (v_label     IS NOT NULL AND v_label     !~ '^[a-z_][a-z0-9_]*$')
     OR (v_label_key IS NOT NULL AND v_label_key !~ '^[a-z_][a-z0-9_]*$')
     OR (v_state     IS NOT NULL AND v_state     !~ '^[a-z_][a-z0-9_]*$')
     OR (v_kind      IS NOT NULL AND v_kind      !~ '^[a-z_][a-z0-9_]*$') THEN
    RETURN jsonb_build_object(
      'data', jsonb_build_object('items', '[]'::jsonb),
      'provenance', jsonb_build_object('source_slug', coalesce(v_view, 'audience'),
                                       'trace_id', 'audience-timeline:missing_config', 'freshness_at', v_now));
  END IF;

  FOR v_f IN SELECT * FROM jsonb_array_elements(v_filters) LOOP
    v_fval := nullif(btrim(coalesce(p_params->>(v_f->>'param'), '')), '');
    IF v_fval IS NOT NULL AND coalesce(v_f->>'src', '') ~ '^[a-z_][a-z0-9_]*$' AND length(v_fval) <= 200 THEN
      v_where_sql := v_where_sql || format(' and v.%I::text = %L', v_f->>'src', v_fval);
    END IF;
  END LOOP;

  EXECUTE format(
    'select coalesce(jsonb_agg(to_jsonb(t) order by t.__rn), ''[]''::jsonb)'
    || ' from (select v.*, row_number() over (order by v.%I %s nulls last) as __rn'
    || '       from public.%I v where v.%I is not null%s limit %s) t',
    v_at, v_dir, v_view, v_at, v_where_sql, v_limit)
  INTO v_raw;

  RETURN jsonb_build_object(
    'data', jsonb_build_object(
      'items', coalesce((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'at',        to_char((r->>v_at)::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                 'label',     CASE WHEN v_label IS NOT NULL THEN nullif(r->>v_label, '') END,
                 'label_key', CASE WHEN v_label_key IS NOT NULL THEN nullif(r->>v_label_key, '') END,
                 'state',     CASE WHEN v_state IS NOT NULL AND (r->>v_state) IN ('ok', 'warning', 'loss')
                                   THEN r->>v_state END,
                 -- ⛔ DRUH JE ŠTÍTEK, NE OBSAH (naměřeno 2026-09-07). Osa dvojčete
                 -- veze 1 573 doteků z CRM, kde `content` je předmět e-mailu. Kdyby
                 -- sem šlo namířit libovolný sloupec, propašoval by se OBSAH do
                 -- odznaku — táž vada, jakou jsme odmítli řešit slepením
                 -- „E-mail · Re: …" do popisku. Obsah zůstává obsahem, druh je
                 -- strojová hodnota ze zdroje (ingest ji vyrábí mapou v profilu).
                 -- Proto projde jen hodnota TVARU ŠTÍTKU; delší nebo s mezerami ne.
                 'kind',      CASE WHEN v_kind IS NOT NULL
                                    AND (r->>v_kind) ~ '^[a-z][a-z0-9_-]{0,39}$'
                                   THEN r->>v_kind END))
               ORDER BY (r->>'__rn')::bigint)
        FROM jsonb_array_elements(v_raw) r), '[]'::jsonb)),
    'provenance', jsonb_build_object(
      'source_slug', v_view,
      'trace_id', 'audience-timeline:' || v_view,
      'freshness_at', v_now));
END;
$$;

REVOKE ALL ON FUNCTION public.get_audience_view_timeline_block(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_audience_view_timeline_block(jsonb) TO authenticated, service_role;

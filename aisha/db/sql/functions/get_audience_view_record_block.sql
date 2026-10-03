-- ============================================================================
-- Source of Truth: get_audience_view_record_block
-- Popis: GENERICKÝ 'record_detail' blok nad ADMIN pohledy publika (ADR-003, K3).
--   Jeden řádek pohledu = jeden záznam: pole, odznaky a citace z KONFIGURACE
--   bloku, identita záznamu z KLIENTSKÉHO parametru (u restricted bloku dorazí
--   jen přes deklaraci `client_params` — get_block_data). Táž stavba a tytéž
--   dvě pojistky jako get_audience_view_table_block: is_admin_or_staff() +
--   jmenný prostor `audience_admin_*_v`.
--
-- Konfigurace (p_params):
--   view       POVINNÉ  ^audience_admin_[a-z0-9_]+_v$
--   key_src    POVINNÉ  sloupec pohledu s identitou záznamu (porovnává se ::text)
--   id_param   volitelné jméno parametru, ve kterém klient posílá identitu
--                        (default 'record_id'; workbench posílá detail_by_kind.param)
--   fields     POVINNÉ  [{key, label_key, src, numeric?}] — pole ke zobrazení
--   badges     volitelné [{src, key_prefix?}] — hodnota sloupce (nebo každý prvek
--                        pole) jako odznak; s key_prefix se z ní stane i18n klíč
--   quote_src  volitelné sloupec s citací (např. poznámka)
--
-- Poctivá degradace: bez práv, bez konfigurace, bez identity nebo bez řádku
-- vrací `record_id: null` s důvodem v provenance.trace_id — nikdy výjimku.
-- Blok „o žádném záznamu" je legitimní stav (klient ještě nic nevybral).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_audience_view_record_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_view      text  := nullif(btrim(coalesce(p_params->>'view', '')), '');
  v_key_src   text  := nullif(btrim(coalesce(p_params->>'key_src', '')), '');
  v_id_param  text  := coalesce(nullif(btrim(coalesce(p_params->>'id_param', '')), ''), 'record_id');
  v_fields    jsonb := CASE WHEN jsonb_typeof(p_params->'fields') = 'array' THEN p_params->'fields' ELSE '[]'::jsonb END;
  v_badges    jsonb := CASE WHEN jsonb_typeof(p_params->'badges') = 'array' THEN p_params->'badges' ELSE '[]'::jsonb END;
  v_quote_src text  := nullif(btrim(coalesce(p_params->>'quote_src', '')), '');
  v_id        text;
  v_row       jsonb;
  v_now       timestamptz := now();
BEGIN
  v_id := nullif(btrim(coalesce(p_params->>v_id_param, '')), '');

  IF NOT public.is_admin_or_staff() THEN
    RETURN public.audience_record_block_empty(v_view, 'unauthorized', v_now);
  END IF;
  IF v_view IS NULL
     OR v_view !~ '^audience_admin_[a-z0-9_]+_v$'
     OR to_regclass('public.' || quote_ident(v_view)) IS NULL
     OR v_key_src IS NULL OR v_key_src !~ '^[a-z_][a-z0-9_]*$'
     OR jsonb_array_length(v_fields) = 0 THEN
    RETURN public.audience_record_block_empty(v_view, 'missing_config', v_now);
  END IF;
  IF v_id IS NULL OR length(v_id) > 200 THEN
    RETURN public.audience_record_block_empty(v_view, 'no_record', v_now);
  END IF;

  -- Dynamický je jen identifikátor pohledu a klíčového sloupce (%I); hodnota
  -- identity je literál (%L). Celý řádek se načte jako jsonb a promítne až potom.
  EXECUTE format('select to_jsonb(v) from public.%I v where v.%I::text = %L limit 1',
                 v_view, v_key_src, v_id)
  INTO v_row;
  IF v_row IS NULL THEN
    RETURN public.audience_record_block_empty(v_view, 'not_found', v_now);
  END IF;

  RETURN jsonb_build_object(
    'data', jsonb_strip_nulls(jsonb_build_object(
      'record_id', v_id,
      'badges', coalesce((
        SELECT jsonb_agg(coalesce(b->>'key_prefix', '') || val ORDER BY ord, val)
        FROM jsonb_array_elements(v_badges) WITH ORDINALITY AS bs(b, ord)
        CROSS JOIN LATERAL (
          SELECT e #>> '{}' AS val
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(v_row->(b->>'src')) = 'array' THEN v_row->(b->>'src')
                      WHEN v_row->(b->>'src') IS NULL OR jsonb_typeof(v_row->(b->>'src')) = 'null' THEN '[]'::jsonb
                      ELSE jsonb_build_array(v_row->(b->>'src')) END) e
          WHERE nullif(btrim(e #>> '{}'), '') IS NOT NULL
        ) vals
        WHERE coalesce(b->>'src', '') ~ '^[a-z_][a-z0-9_]*$'
      ), '[]'::jsonb),
      'fields', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'key',       f->>'key',
                 'label_key', f->>'label_key',
                 'value',     CASE
                                WHEN (f->>'numeric')::boolean IS TRUE
                                  THEN to_jsonb(nullif(v_row->>(f->>'src'), '')::numeric)
                                WHEN jsonb_typeof(v_row->(f->>'src')) = 'array'
                                  THEN to_jsonb((SELECT string_agg(e #>> '{}', ', ')
                                                 FROM jsonb_array_elements(v_row->(f->>'src')) e))
                                WHEN v_row->(f->>'src') IS NULL OR jsonb_typeof(v_row->(f->>'src')) = 'null'
                                  THEN 'null'::jsonb
                                ELSE to_jsonb(v_row->>(f->>'src'))
                              END)
               ORDER BY ord)
        FROM jsonb_array_elements(v_fields) WITH ORDINALITY AS fs(f, ord)
        WHERE nullif(f->>'key', '') IS NOT NULL AND nullif(f->>'label_key', '') IS NOT NULL
      ), '[]'::jsonb),
      'quote', CASE WHEN v_quote_src IS NOT NULL THEN nullif(v_row->>v_quote_src, '') END)),
    'provenance', jsonb_build_object(
      'source_slug', v_view,
      'trace_id', 'audience-record:' || v_view,
      'freshness_at', v_now));
END;
$$;

REVOKE ALL ON FUNCTION public.get_audience_view_record_block(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_audience_view_record_block(jsonb) TO authenticated, service_role;

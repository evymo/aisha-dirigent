-- ============================================================================
-- Source of Truth: get_twin_events_table_block
-- Popis: GENERICKÝ 'table' blok nad twin substrátem: události daného typu
--        jako řádky, sloupce deklarované KONFIGURACÍ bloku. Žádná doménová
--        ani instanční hodnota v kódu — vše přichází v p_params (dispatcher
--        get_block_data merguje surface_blocks.source_params || p_params,
--        takže konfigurace = řádek bloku v instance overlay).
--
-- Konfigurace (p_params):
--   event_type   POVINNÉ   typ události (twin_events.event_type)
--   columns      POVINNÉ   pole [{key, label | label_key, src, numeric?}]
--                          src: 'twin_label' | 'place_label' | 'occurred_at'
--                               | 'attr:<jméno>' (hodnota z attrs)
--                          numeric: true → attr se emituje jako číslo
--   limit        volitelné default 50, strop 200
--   sort         volitelné 'occurred_desc' (default) | 'place_label_asc'
--   sort_attr_desc volitelné jméno attrs klíče — sekundární číselné řazení
--                  (jen se sort='place_label_asc')
--
-- Poctivá degradace: chybějící konfigurace → prázdná data s
--   provenance.error='missing_config', nikdy výjimka (blok se přizná).
-- Provenance: source_slug ODVOZEN z dat (distinct twin_events.source).
-- Bezpečnost: SECURITY DEFINER (čte substrát napříč RLS) + auth guard.
-- Vzniklo vykostěním get_porada_activity + get_object_tenants (07-25):
--   tytéž bloky teď jedou přes tuhle funkci s konfigurací v instančním datovém repu.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_twin_events_table_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  with cfg as (
    select p_params->>'event_type' as ev,
           coalesce(p_params->'columns', '[]'::jsonb) as cols,
           least(coalesce((p_params->>'limit')::int, 50), 200) as lim,
           coalesce(p_params->>'sort', 'occurred_desc') as srt,
           p_params->>'sort_attr_desc' as srt_attr
  ),
  src as (
    select e.id, coalesce(e.occurred_at, e.created_at) as ts, e.source,
           c.label as twin_label, o.label as place_label, e.attrs,
           row_number() over (order by
             case when (select srt from cfg) = 'place_label_asc' then o.label end asc nulls last,
             case when (select srt from cfg) = 'place_label_asc' and (select srt_attr from cfg) is not null
                  then nullif(e.attrs->>(select srt_attr from cfg), '')::numeric end desc nulls last,
             coalesce(e.occurred_at, e.created_at) desc) as rn
    from twin_events e
    join twin_entities c on c.id = e.twin_id
    left join twin_entities o on o.id = e.place_twin_id
    where e.event_type = (select ev from cfg)
  ),
  rendered as (
    select s.rn, s.source,
      (select jsonb_object_agg(col->>'key',
         case
           when col->>'src' = 'twin_label'  then to_jsonb(s.twin_label)
           when col->>'src' = 'place_label' then to_jsonb(s.place_label)
           when col->>'src' = 'occurred_at' then to_jsonb(to_char(s.ts, 'YYYY-MM-DD'))
           when (col->>'numeric')::boolean is true
             then to_jsonb(nullif(s.attrs->>(substring(col->>'src' from '^attr:(.*)$')), '')::numeric)
           else coalesce(to_jsonb(s.attrs->>(substring(col->>'src' from '^attr:(.*)$'))), 'null'::jsonb)
         end)
       from jsonb_array_elements((select cols from cfg)) col) as row_obj
    from src s
    where s.rn <= (select lim from cfg)
  )
  select case
    -- ⛔ NÁROK PODLE ROLE, NE PODLE PUBLIKA BLOKU (slití 2026-09-13). Upstream tu
    -- měl kontrolu „volající je v publiku NĚJAKÉHO aktivního bloku s touto
    -- funkcí" (audit U4-5). Ta ale neváže `event_type` z požadavku na
    -- `source_params` toho bloku — funkce je GRANT authenticated a volá se přímo
    -- přes /rpc/, takže člen publika bloku s typem A přečetl libovolný typ B.
    -- Tabulka navíc NEMÁ omezení po řádcích, tedy patří jen tomu, kdo smí vidět
    -- všechno. Diferenciálně měří `definer-narok-ne-jen-prihlaseni.runtime.test.ts`.
    -- ⛔ NÁROK, NE JEN PŘIHLÁŠENÍ (naměřeno 2026-09-11): guard ověřoval, že jsi
    -- přihlášený, ne že na to máš nárok — řidič bez rolí dostával totéž co admin.
    when not (public.is_admin_or_staff() or public.is_service_role()) then
      -- Tabulka BEZ `columns` není kontraktní tabulka, takže tahle větev
      -- (a s ní celý blok) mizela beze slova. Provenance ze stejného důvodu:
      -- `error` v ní schéma nezná, důvod patří do `trace_id`.
      jsonb_build_object('data', jsonb_build_object('columns', '[]'::jsonb, 'rows', '[]'::jsonb),
        'provenance', jsonb_build_object('source_slug', 'twin_events',
          'trace_id', 'twin-events:unauthorized', 'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
    when (select ev from cfg) is null or jsonb_array_length((select cols from cfg)) = 0 then
      jsonb_build_object('data', jsonb_build_object('columns', '[]'::jsonb, 'rows', '[]'::jsonb),
        'provenance', jsonb_build_object('source_slug', 'twin_events',
          'trace_id', 'twin-events:missing_config', 'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
    else jsonb_build_object(
      'data', jsonb_build_object(
        'columns', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                      'key', c->>'key', 'label', c->>'label', 'label_key', c->>'label_key')))
                    from jsonb_array_elements((select cols from cfg)) c),
        'rows', coalesce((select jsonb_agg(row_obj order by rn) from rendered), '[]'::jsonb)),
      'provenance', jsonb_build_object(
        'source_slug', coalesce((select string_agg(distinct r2.source, '+') from rendered r2), 'twin_events'),
        'trace_id', 'twin-events:' || (select ev from cfg),
        'freshness_at', now()))
  end;
$$;

REVOKE ALL ON FUNCTION public.get_twin_events_table_block(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_twin_events_table_block(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_twin_events_table_block(jsonb) TO service_role;

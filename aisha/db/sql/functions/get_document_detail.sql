-- Data RPC for a 'record_detail' block: one document's extracted fields from the
-- local-ingest evidence silo (li_source_registry.fields). SECURITY INVOKER — the
-- li_source_registry RLS decides visibility.
--
-- Scoped by p_params->>'doc_slug' (or 'document_id' as an alias — the workbench
-- passes whatever the register row's `id` carried, which is doc_slug). Reads the
-- authoritative fields jsonb whose per-field shape is the ingest artifact field:
--   { value, raw, confidence, status, source_span:{char_start,char_end,page} }.
-- Maps each to a RecordField {key,label_key,value,state,confidence,source_ref}.
-- fields_pending_review ({ <key>: <status> }) marks which keys still await a human;
-- a pending key overrides the field state to needs_review so the operator sees it.
--
-- Contract: (jsonb) -> jsonb {data:{record_id,badges,fields,quote?}, provenance}.

-- ⭐ ČERSTVOST Z DAT (brána `cerstvost-z-dat`, 2026-09-27): `freshness_at` = nejnovější čas
-- univerza bloku, spočtený ze STEJNÝCH řádků jako hodnota. Pořadí zdrojů času: čas ze zdroje
-- (u Money `source_modified_at`, až bude úplný; u jízd/událostí `occurred_at`) › příchod verze
-- dokladu (`created_at`). NE `ingested_at`/`updated_at` — ty přepisuje KAŽDÝ import (naměřeno
-- 2026-09-27: 813 smluv = jediný čas), takže by lhaly jako faktury zamrzlé na exportu ze 6. 8.
-- Hranice `created_at`: backfill starých dokladů má čas dnešní — pravda o příchodu, ne o obsahu.
-- Prázdné univerzum → `trace_id` nese `:no_data` a čas je jen záloha `coalesce(…, now())`.
-- Stav linky (běží/neběží) sem NEPATŘÍ — je to jiný signál.
create or replace function public.get_document_detail(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with doc as (
    select r.*
    from public.li_source_registry r
    where r.doc_slug = coalesce(p_params->>'doc_slug', p_params->>'document_id')
    limit 1
  ),
  flds as (
    select jsonb_agg(
             jsonb_build_object(
               'key',        f.key,
               'label_key',  'app.wb.field.' || f.key,
               'value',      coalesce(f.value->>'value', f.value #>> '{}'),
               'state',      lower(coalesce(
                               -- a still-pending field wins over its stored status
                               doc.fields_pending_review->>f.key,
                               f.value->>'status',
                               'needs_review')),
               'confidence', (f.value->>'confidence')::numeric,
               'source_ref', case when f.value ? 'source_span' then f.value->'source_span' else null end
             )
             order by f.key
           ) as arr
    from doc, lateral jsonb_each(coalesce(doc.fields, '{}'::jsonb)) as f
    where jsonb_typeof(doc.fields) = 'object'
  )
  -- A record_detail block asks for ONE document, so an absent or unknown slug is
  -- an ordinary state, not a failure. Returning NULL made get_block_data raise
  -- "data rpc returned null", which reads like a broken producer; the block now
  -- degrades the same way every other block does — shaped, empty, and honest
  -- about why.
  select coalesce(
    (select jsonb_build_object(
    'data', jsonb_build_object(
      'record_id', doc.doc_slug,
      'badges', jsonb_build_array(
        'app.wb.doctype.' || doc.doc_type,
        case when doc.status = 'AUTO_PASS' then 'app.wb.state.auto_pass' else 'app.wb.state.needs_review' end
      ),
      'fields', coalesce(flds.arr, '[]'::jsonb),
      -- ⭐ ŘÁDKOVÉ POLOŽKY (doplněno 2026-08-05). Bez nich detail faktury
      -- odpovídal jen „kolik", nikdy „za co" — a u pohledávky je právě to
      -- druhé důvod, proč se na doklad kliká. Položky nese registr jako pole
      -- validovaných řádků; posílají se, jak jsou, aby tu nevzniklo další
      -- místo se znalostí toho, co zdroj obsahuje.
      'line_items', coalesce(doc.line_items, '[]'::jsonb),
      'lines_pending', coalesce(doc.lines_pending_review, 0),
      -- Co dokladu chybí do úplnosti — neúplný doklad se má poznat, ne mlčet.
      'missing', to_jsonb(coalesce(doc.missing_required, '{}'::text[])),
      -- ⭐ ZDROJ VERBATIM jen na vyžádání (`include_source=true`): původní záznam
      -- z ERP tak, jak přišel. Slouží k doložení „odkud to číslo je" a k revizi
      -- výkladu proti zdroji. Ve výchozím stavu se NEPOSÍLÁ — je to nejtučnější
      -- část odpovědi a k vykreslení detailu není potřeba.
      'source_record', case when coalesce(p_params->>'include_source', '') = 'true'
                            then doc.raw_data->'source_record' end,
      'quote', doc.filename
    ),
    'provenance', jsonb_build_object(
      'source_slug',  coalesce(doc.ingest_source_slug, 'li-source-registry'),
      'freshness_at', to_char(doc.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'doc-detail:' || doc.doc_slug
    )
  )
  from doc left join flds on true),
    jsonb_build_object(
      'data', jsonb_build_object('record_id', null, 'badges', '[]'::jsonb, 'fields', '[]'::jsonb),
      -- Kontraktní tvar i v prázdné větvi: `error` navíc a chybějící
      -- freshness_at porušovaly schéma obálky, takže klient blok CELÝ zahodil
      -- místo aby ukázal prázdno. Důvod prázdna (chybějící param, neznámý slug,
      -- neviditelný dokument) NENÍ provenance — a rozlišovat ho pro volajícího
      -- by navíc prozradilo existenci dokumentu, který nesmí vidět.
      'provenance', jsonb_build_object(
        'source_slug',  'li-source-registry',
        'trace_id',     'doc-detail:not_found',
        'freshness_at', now())));
$$;

revoke all on function public.get_document_detail(jsonb) from public, anon;
grant execute on function public.get_document_detail(jsonb) to authenticated, service_role;

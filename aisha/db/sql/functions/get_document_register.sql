-- Data RPC for a 'table' block: the document register from the local-ingest
-- evidence silo (li_source_registry). SECURITY INVOKER — li_source_registry RLS
-- (is_admin_or_staff, RPC-only lockdown) decides visibility; a caller without a
-- grant sees an empty table, never an error (existence is not leaked).
--
-- Reads li_source_registry (what ingest actually fills via li_upsert_source_registry),
-- NOT the generic document_registry (which has no writer — the surface DRAFT pointed
-- there and would have rendered an empty console over real evidence). The per-field
-- authoritative shape lives in li_source_registry.fields
--   { <key>: { value, raw, confidence, status, source_span:{char_start,char_end,page} } }.
--
-- Contract: (jsonb) -> jsonb {data:{columns,rows}, provenance{source_slug,freshness_at,trace_id}}.
-- Each row carries `id` = doc_slug — the content identity li keys everything on
-- (obligations.doc_slug, links.from_slug); the workbench opens detail/obligations by it.
-- Optional filter p_params->>'doc_type'. Superseded versions (superseded_by not null) are excluded.

create or replace function public.get_document_register(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with rows as (
    select
      r.doc_slug                                        as id,
      r.doc_type                                        as doc_type,
      coalesce(r.filename, r.doc_slug)                  as filename,
      coalesce(r.fields->'counterparty'->>'value', '—') as counterparty,
      -- ZA KTEROU Z NAŠICH FIREM doklad je. Bez toho sloupce se v knize faktur
      -- nepozná, čí ta faktura vlastně je — a u portfolia víc firem je to první
      -- otázka, ne detail.
      coalesce(r.fields->'owner_company'->>'value', '—') as owner_company,
      -- STAV ÚHRADY. Pravdu nese `amount_unpaid` (Money UhradyZbyva): 0 = uhrazeno,
      -- > 0 = dluh. NIKOLI `settled` — to je PriznakVyrizeno a u uhrazené faktury
      -- bývá False. Doklad, který stav úhrady vůbec nenese (starší korpus), říká
      -- „?" a NE „neuhrazeno": mlčet je správnější než tvrdit dluh z pole, které
      -- o platbě nic neví.
      case
        when not (r.fields ? 'amount_unpaid') then '?'
        when (r.fields->'amount_unpaid'->>'value') !~ '^-?[0-9]+(\.[0-9]+)?$' then '?'
        when (r.fields->'amount_unpaid'->>'value')::numeric <= 0.005 then 'ano'
        else 'ne'
      end                                                as paid,
      r.status                                          as status,
      cardinality(r.missing_required)                   as missing,
      to_char(r.ingested_at, 'YYYY-MM-DD')              as ingested,
      r.ingested_at                                     as _sort
    from public.li_source_registry r
    where r.superseded_by is null
      and (p_params->>'doc_type' is null or r.doc_type = p_params->>'doc_type')
      -- Pohled podle firmy: týž parametr, jaký posílá přepínač nad sekcí.
      and (nullif(p_params->>'owner_company','') is null
           or r.fields->'owner_company'->>'value' = p_params->>'owner_company')
    order by r.ingested_at desc
    -- STROP, protože registr roste a tabulka na obrazovce ne. Naměřeno na
    -- produkci 2026-07-31 (surface-timing, identita extranet-test-admin) hned po
    -- nasazení sekce „Smlouvy a nájmy": blok `sm_invoices` vrátil 23 739 řádků
    -- = 5,06 MB / 727 ms v JEDNÉ odpovědi. Doklad má ve wire formátu ~220 B,
    -- takže „vrátíme všechno" je linie rostoucí s korpusem bez konce — ne
    -- vlastnost. Default 500 unese i telefon; kdo chce jinak, řekne si o to
    -- v source_params bloku (limit je DATA, ne konstanta v kódu). 5 000 je tvrdá
    -- pojistka: nad ní to není tabulka k prohlížení, ale export — a ten má
    -- vlastní cestu.
    limit least(coalesce(nullif(p_params->>'limit', '')::int, 500), 5000)
    offset greatest(coalesce(nullif(p_params->>'offset', '')::int, 0), 0)
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'columns', jsonb_build_array(
        jsonb_build_object('key', 'doc_type',     'label_key', 'app.wb.col.doc_type'),
        jsonb_build_object('key', 'filename',     'label_key', 'app.wb.col.filename'),
        jsonb_build_object('key', 'counterparty', 'label_key', 'app.wb.col.counterparty'),
        jsonb_build_object('key', 'owner_company','label_key', 'app.wb.col.owner_company'),
        jsonb_build_object('key', 'paid',         'label_key', 'app.wb.col.paid', 'align', 'center'),
        jsonb_build_object('key', 'status',       'label_key', 'app.wb.col.status',  'align', 'center'),
        jsonb_build_object('key', 'missing',      'label_key', 'app.wb.col.missing',  'align', 'right'),
        jsonb_build_object('key', 'ingested',     'label_key', 'app.wb.col.ingested', 'align', 'right')
      ),
      -- Druh se říká VÝSLOVNĚ, i když je shodný s výchozím: mlčení by
      -- znamenalo, že se na chování spoléhá, aniž by to kdokoli deklaroval.
      'row_kind', 'document',
      'rows', coalesce(jsonb_agg(to_jsonb(rows) - '_sort'), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'li-source-registry',
      'freshness_at', to_char(coalesce(max(rows._sort), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'doc-register'
    ) || public.scope_applied(p_params, 'owner_company')
  )
  from rows;
$$;

revoke all on function public.get_document_register(jsonb) from public, anon;
grant execute on function public.get_document_register(jsonb) to authenticated, service_role;

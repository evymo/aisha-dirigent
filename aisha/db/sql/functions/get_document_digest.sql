-- Data RPC for a 'kpi_tile' block: one headline count for the document-management
-- console, over the local-ingest evidence silo. SECURITY INVOKER — li_* RLS decides
-- what the operator can count. The metric is chosen by p_params->>'metric' (seeded
-- per block via source_params):
--   'registered'     — valid (non-superseded) documents in li_source_registry
--   'pending_review' — docs still in REVIEW + obligations still NEEDS_REVIEW
--                      (the actionable backlog)
--   'contracts'      — documents of the contractual evidence class
--   'findings'       — deterministic cross-document findings (li_findings)
-- Unknown metric → pending_review (the safe actionable default).
-- Contract: (jsonb) -> jsonb {data:{value,state?}, provenance}.

-- ⭐ ČERSTVOST Z DAT (brána `cerstvost-z-dat`, 2026-09-27): `freshness_at` = nejnovější čas
-- univerza bloku, spočtený ze STEJNÝCH řádků jako hodnota. Pořadí zdrojů času: čas ze zdroje
-- (u Money `source_modified_at`, až bude úplný; u jízd/událostí `occurred_at`) › příchod verze
-- dokladu (`created_at`). NE `ingested_at`/`updated_at` — ty přepisuje KAŽDÝ import (naměřeno
-- 2026-09-27: 813 smluv = jediný čas), takže by lhaly jako faktury zamrzlé na exportu ze 6. 8.
-- Hranice `created_at`: backfill starých dokladů má čas dnešní — pravda o příchodu, ne o obsahu.
-- Prázdné univerzum → `trace_id` nese `:no_data` a čas je jen záloha `coalesce(…, now())`.
-- Stav linky (běží/neběží) sem NEPATŘÍ — je to jiný signál.
-- ⭐ OSA „PODLE FIRMY" (2026-09-28). Blok stál v sekci Smlouvy vedle přehledů, které
-- firmu filtrují, a sám ukazoval celý podnik — pod zvolenou firmou tak dvě čísla vedle
-- sebe mluvila o jiné množině. Firma = `owner_company` v hlavičce dokladu (táž hodnota,
-- jakou nabízí get_scope_options); povinnosti a zjištění patří firmě přes SVŮJ doklad.
-- Bez osy je výsledek bajtově týž jako dřív. Že filtroval, říká blok sám:
-- provenance || scope_applied(…).
create or replace function public.get_document_digest(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with metric as (select coalesce(p_params->>'metric', 'pending_review') as m),
  cfg as (select nullif(p_params->>'owner_company', '') as firma),
  -- Jeden výřez registru pro všechny metriky. Úzké sloupce: CTE čtená víckrát se
  -- materializuje a `select r.*` by kopírovalo raw_data desítek tisíc dokladů.
  reg as (
    select r.source_sha256, r.doc_class, r.status, r.created_at
    from public.li_source_registry r, cfg
    where r.superseded_by is null
      and (cfg.firma is null or r.fields->'owner_company'->>'value' = cfg.firma)
  ),
  obl as (
    select o.candidate_status, o.created_at
    from public.li_obligations o, cfg
    where cfg.firma is null
       or exists (select 1 from reg where reg.source_sha256 = o.source_sha256)
  ),
  fnd as (
    select f.created_at
    from public.li_findings f, cfg
    where cfg.firma is null
       or exists (select 1 from jsonb_array_elements(f.documents) d
                   join reg on reg.source_sha256 = d->>'source_sha256')
  ),
  v as (
    select case (select m from metric)
      when 'registered' then
        (select count(*) from reg)
      when 'contracts' then
        (select count(*) from reg where doc_class = 'contractual')
      when 'findings' then
        (select count(*) from fnd)
      else /* pending_review */ (
          (select count(*) from reg where status = 'REVIEW')
        + (select count(*) from obl where candidate_status = 'NEEDS_REVIEW')
      )
    end as value
  ),
  f as (
    select case (select m from metric)
      when 'registered' then
        (select max(created_at) from reg)
      when 'contracts' then
        (select max(created_at) from reg where doc_class = 'contractual')
      when 'findings' then
        (select max(created_at) from fnd)
      else greatest(
          (select max(created_at) from reg where status = 'REVIEW'),
          (select max(created_at) from obl where candidate_status = 'NEEDS_REVIEW'))
    end as fresh
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'value', v.value,
      -- Only the actionable backlog gets a warning tint; other metrics stay neutral.
      'state', case when (select m from metric) = 'pending_review' and v.value > 0 then 'warning' else 'ok' end
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'li-evidence-registry',
      'freshness_at', to_char(coalesce((select fresh from f), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'doc-digest:' || (select m from metric)
                      || case when (select fresh from f) is null then ':no_data' else '' end
    ) || public.scope_applied(p_params, 'owner_company')
  )
  from v;
$$;

revoke all on function public.get_document_digest(jsonb) from public, anon;
grant execute on function public.get_document_digest(jsonb) to authenticated, service_role;

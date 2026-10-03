-- Data RPC for a 'chart' block (kind='bar'): receivables/payables AGING — unpaid
-- invoices bucketed by how far past (or before) their due date they sit, so the
-- reader sees WHERE the money is stuck, not just the total. p_params->>'direction'
-- picks the ledger: 'issued' = pohledávky (owed to us), 'received' = závazky (owed
-- by us). One function, two blocks (DRY).
--
-- Buckets, oldest-debt-last on the axis: do splatnosti (dueDate ≥ today), 1–30,
-- 31–60, 61–90, 90+ dní po splatnosti. Bar value = Kč in the bucket, `note` = how
-- many invoices. Bucket labels are literal range descriptors: a chart point label
-- is DATA by the block contract (schemas.ts chartPoint has no label_key channel,
-- same as the per-vehicle/per-month labels on the other fleet/vedení charts).
--
-- Reads document_registry (metadata contract: see get_vedeni_finance_kpi). Unpaid =
-- financial.paidDate IS NULL. SECURITY INVOKER → RLS fails closed; empty ledger →
-- five 0-bars (a real "nothing outstanding"), distinct from an error. Contract:
-- (jsonb) -> jsonb {data:{kind,unit_key,points[]}, provenance}.

-- ⭐ ČERSTVOST Z DAT (brána `cerstvost-z-dat`, 2026-09-27): `freshness_at` = nejnovější čas
-- univerza bloku, spočtený ze STEJNÝCH řádků jako hodnota. Pořadí zdrojů času: čas ze zdroje
-- (u Money `source_modified_at`, až bude úplný; u jízd/událostí `occurred_at`) › příchod verze
-- dokladu (`created_at`). NE `ingested_at`/`updated_at` — ty přepisuje KAŽDÝ import (naměřeno
-- 2026-09-27: 813 smluv = jediný čas), takže by lhaly jako faktury zamrzlé na exportu ze 6. 8.
-- Hranice `created_at`: backfill starých dokladů má čas dnešní — pravda o příchodu, ne o obsahu.
-- Prázdné univerzum → `trace_id` nese `:no_data` a čas je jen záloha `coalesce(…, now())`.
-- Stav linky (běží/neběží) sem NEPATŘÍ — je to jiný signál.
create or replace function public.get_vedeni_aging(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with p as (
    select case when p_params->>'direction' = 'received' then 'received' else 'issued' end as dir
  ),
  unpaid as (
    select
      r.created_at as vznik,
      (r.metadata->'financial'->>'totalAmount')::numeric as total,
      (r.metadata->'financial'->>'dueDate')::date        as due
    from public.document_registry r, p
    where r.doc_type = 'invoice'
      and coalesce(r.metadata->>'direction','issued') = p.dir
      and r.doc_date >= date '2024-01-01'
      and nullif(r.metadata->'financial'->>'paidDate','') is null           -- neuhrazené
      and r.metadata->'financial'->>'totalAmount' ~ '^-?[0-9]+(\.[0-9]+)?$'
  ),
  bucketed as (
    select
      case
        when due is null then 4                          -- bez splatnosti → k „po splatnosti"
        when due >= current_date then 0                  -- do splatnosti
        when current_date - due <= 30 then 1
        when current_date - due <= 60 then 2
        when current_date - due <= 90 then 3
        else 4
      end as b,
      total
    from unpaid
  ),
  -- Kostra košů (i prázdné se musí vykreslit) × naměřené sumy.
  buckets(b, lbl) as (
    values (0,'do spl.'), (1,'1–30 d'), (2,'31–60 d'), (3,'61–90 d'), (4,'90+ d')
  ),
  agg as (
    select k.b, k.lbl,
           coalesce(count(x.total), 0) as cnt,
           coalesce(sum(x.total), 0)   as amount
    from buckets k
    left join bucketed x on x.b = k.b
    group by k.b, k.lbl
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'kind', 'bar',
      'unit_key', 'app.vedeni.unit.czk',
      'points', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'label', lbl,
            'value', round(amount),
            'note',  cnt::text        -- kolik faktur v koši
          ) order by b
        ) from agg
      ), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'money-s5',
      'freshness_at', to_char(coalesce((select max(vznik) from unpaid), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'vedeni-aging:' || (select dir from p)
                      || case when (select max(vznik) from unpaid) is null then ':no_data' else '' end
    )
  );
$$;

revoke all on function public.get_vedeni_aging(jsonb) from public, anon;
grant execute on function public.get_vedeni_aging(jsonb) to authenticated, service_role;

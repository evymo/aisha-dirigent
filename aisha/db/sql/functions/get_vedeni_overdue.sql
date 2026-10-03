-- Data RPC for a 'table' block: WHO owes the most past due — unpaid, past-due
-- invoices grouped by counterparty, worst exposure first. p_params->>'direction'
-- ('issued'=pohledávky, 'received'=závazky). p_params->>'limit' (default 12).
--
-- Reads document_registry (metadata contract: see get_vedeni_finance_kpi). A row is
-- one counterparty: number of overdue invoices, total Kč past due, and age of the
-- oldest one (the number that decides whether it is a phone call or a lawyer).
--
-- SECURITY INVOKER → RLS on document_registry fails closed. Contract:
-- (jsonb) -> jsonb {data:{columns[],row_kind,rows[]}, provenance}.

-- ⭐ ČERSTVOST Z DAT (brána `cerstvost-z-dat`, 2026-09-27): `freshness_at` = nejnovější čas
-- univerza bloku, spočtený ze STEJNÝCH řádků jako hodnota. Pořadí zdrojů času: čas ze zdroje
-- (u Money `source_modified_at`, až bude úplný; u jízd/událostí `occurred_at`) › příchod verze
-- dokladu (`created_at`). NE `ingested_at`/`updated_at` — ty přepisuje KAŽDÝ import (naměřeno
-- 2026-09-27: 813 smluv = jediný čas), takže by lhaly jako faktury zamrzlé na exportu ze 6. 8.
-- Hranice `created_at`: backfill starých dokladů má čas dnešní — pravda o příchodu, ne o obsahu.
-- Prázdné univerzum → `trace_id` nese `:no_data` a čas je jen záloha `coalesce(…, now())`.
-- Stav linky (běží/neběží) sem NEPATŘÍ — je to jiný signál.
create or replace function public.get_vedeni_overdue(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with p as (
    select case when p_params->>'direction' = 'received' then 'received' else 'issued' end as dir,
           coalesce((p_params->>'limit')::int, 12) as lim
  ),
  overdue as (
    select
      r.created_at as vznik,
      coalesce(nullif(r.counterparty,''), '—')            as party,
      (r.metadata->'financial'->>'totalAmount')::numeric  as total,
      (r.metadata->'financial'->>'dueDate')::date         as due
    from public.document_registry r, p
    where r.doc_type = 'invoice'
      and coalesce(r.metadata->>'direction','issued') = p.dir
      and r.doc_date >= date '2024-01-01'
      and nullif(r.metadata->'financial'->>'paidDate','') is null
      and r.metadata->'financial'->>'totalAmount' ~ '^-?[0-9]+(\.[0-9]+)?$'
      and (r.metadata->'financial'->>'dueDate')::date < current_date
  ),
  per_party as (
    select party,
           count(*)              as cnt,
           sum(total)            as amount,
           max(current_date - due) as oldest_days
    from overdue
    group by party
    order by sum(total) desc
    limit (select lim from p)
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'row_kind', 'overdue_party',
      'columns', jsonb_build_array(
        jsonb_build_object('key','party',  'label_key','app.vedeni.col.party',  'align','left'),
        jsonb_build_object('key','count',  'label_key','app.vedeni.col.count',  'align','right'),
        jsonb_build_object('key','amount', 'label_key','app.vedeni.col.overdue','align','right'),
        jsonb_build_object('key','oldest', 'label_key','app.vedeni.col.oldest', 'align','right')
      ),
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id',     md5(party),
            'party',  party,
            'count',  cnt,
            'amount', round(amount),
            'oldest', oldest_days
          ) order by amount desc
        ) from per_party
      ), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'money-s5',
      'freshness_at', to_char(coalesce((select max(vznik) from overdue), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'vedeni-overdue:' || (select dir from p)
                      || case when (select max(vznik) from overdue) is null then ':no_data' else '' end
    )
  );
$$;

revoke all on function public.get_vedeni_overdue(jsonb) from public, anon;
grant execute on function public.get_vedeni_overdue(jsonb) to authenticated, service_role;

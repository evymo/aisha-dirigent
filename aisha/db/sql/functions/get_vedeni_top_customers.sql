-- Data RPC for a 'table' block: top customers by revenue — how concentrated the
-- business is. Issued invoices over the window (p_params->>'days', default 365)
-- summed per counterparty, with each one's share of total turnover. The share
-- column is the point: a single customer at 40 %+ is a dependency risk the owner
-- should see named, not buried. p_params->>'limit' (default 10).
--
-- Reads document_registry (metadata contract: see get_vedeni_finance_kpi).
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
create or replace function public.get_vedeni_top_customers(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with p as (
    select coalesce((p_params->>'days')::int, 365) as days,
           coalesce((p_params->>'limit')::int, 10) as lim
  ),
  win as (select (now() - make_interval(days => (select days from p)))::date as since),
  billed as (
    select
      r.created_at as vznik,
      coalesce(nullif(r.counterparty,''), '—')           as party,
      (r.metadata->'financial'->>'totalAmount')::numeric as total
    from public.document_registry r
    where r.doc_type = 'invoice'
      and coalesce(r.metadata->>'direction','issued') = 'issued'
      and r.doc_date >= (select since from win)
      and r.metadata->'financial'->>'totalAmount' ~ '^-?[0-9]+(\.[0-9]+)?$'
  ),
  total as (select nullif(sum(total), 0) as grand from billed),
  per_party as (
    select party, count(*) as cnt, sum(total) as revenue
    from billed
    group by party
    order by sum(total) desc
    limit (select lim from p)
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'row_kind', 'customer',
      'columns', jsonb_build_array(
        jsonb_build_object('key','party',   'label_key','app.vedeni.col.party',   'align','left'),
        jsonb_build_object('key','revenue', 'label_key','app.vedeni.col.revenue', 'align','right'),
        jsonb_build_object('key','share',   'label_key','app.vedeni.col.share',   'align','right'),
        jsonb_build_object('key','count',   'label_key','app.vedeni.col.invoices','align','right')
      ),
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id',      md5(party),
            'party',   party,
            'revenue', round(revenue),
            -- podíl na obratu; bez obratu (grand null) je NEMĚŘENO, ne 0
            'share',   case when (select grand from total) is not null
                            then round(100.0 * revenue / (select grand from total)) end,
            'count',   cnt
          ) order by revenue desc
        ) from per_party
      ), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'money-s5',
      'freshness_at', to_char(coalesce((select max(vznik) from billed), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'vedeni-top-customers'
                      || case when (select max(vznik) from billed) is null then ':no_data' else '' end
    )
  );
$$;

revoke all on function public.get_vedeni_top_customers(jsonb) from public, anon;
grant execute on function public.get_vedeni_top_customers(jsonb) to authenticated, service_role;

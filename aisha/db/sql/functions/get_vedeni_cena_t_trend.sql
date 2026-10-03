-- Data RPC for a 'chart' block (kind='bar'): average realised price per tonne of
-- stone, month by month — the single number that says whether the pit is holding
-- its margin or discounting to keep trucks moving. Per month = Σ(line value of
-- stone rows) / Σ(tonnes billed), from issued invoices. p_params->>'months' (12).
--
-- Reads document_registry (metadata contract: see get_vedeni_finance_kpi); a line
-- is stone when unit='t'. A month with no stone billed is omitted (no bar), never
-- drawn as 0 — a zero price would read as "gave it away", which is not what
-- "didn't sell any" means. SECURITY INVOKER → RLS fails closed. Contract:
-- (jsonb) -> jsonb {data:{kind,unit_key,points[]}, provenance}.

-- ⭐ ČERSTVOST Z DAT (brána `cerstvost-z-dat`, 2026-09-27): `freshness_at` = nejnovější čas
-- univerza bloku, spočtený ze STEJNÝCH řádků jako hodnota. Pořadí zdrojů času: čas ze zdroje
-- (u Money `source_modified_at`, až bude úplný; u jízd/událostí `occurred_at`) › příchod verze
-- dokladu (`created_at`). NE `ingested_at`/`updated_at` — ty přepisuje KAŽDÝ import (naměřeno
-- 2026-09-27: 813 smluv = jediný čas), takže by lhaly jako faktury zamrzlé na exportu ze 6. 8.
-- Hranice `created_at`: backfill starých dokladů má čas dnešní — pravda o příchodu, ne o obsahu.
-- Prázdné univerzum → `trace_id` nese `:no_data` a čas je jen záloha `coalesce(…, now())`.
-- Stav linky (běží/neběží) sem NEPATŘÍ — je to jiný signál.
create or replace function public.get_vedeni_cena_t_trend(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with p as (select coalesce((p_params->>'months')::int, 12) as months),
  win as (
    select date_trunc('month', now())::date
           - make_interval(months => (select months from p) - 1) as since
  ),
  stone as (
    select
      r.created_at as vznik,
      date_trunc('month', r.doc_date)::date          as mon,
      (l->>'quantity')::numeric                       as qty,
      case when l->>'lineTotal' ~ '^-?[0-9]+(\.[0-9]+)?$'
           then (l->>'lineTotal')::numeric end        as line_total
    from public.document_registry r
    cross join lateral jsonb_array_elements(coalesce(r.metadata->'lines','[]'::jsonb)) l
    where r.doc_type = 'invoice'
      and coalesce(r.metadata->>'direction','issued') = 'issued'
      and r.doc_date >= (select since from win)::date
      and l->>'unit' = 't'
      and l->>'quantity' ~ '^-?[0-9]+(\.[0-9]+)?$'
  ),
  per_month as (
    select mon, sum(qty) as tonnes, sum(line_total) as value
    from stone
    group by mon
    having sum(qty) > 0
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'kind', 'bar',
      'unit_key', 'app.vedeni.unit.czk_t',
      'points', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'label', to_char(mon, 'MM/YYYY'),
            'value', round(value / tonnes),
            'note',  round(tonnes)::text     -- kolik tun stálo za tou cenou
          ) order by mon
        ) from per_month
      ), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'money-s5',
      'freshness_at', to_char(coalesce((select max(vznik) from stone), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'vedeni-cena-t-trend'
                      || case when (select max(vznik) from stone) is null then ':no_data' else '' end
    )
  );
$$;

revoke all on function public.get_vedeni_cena_t_trend(jsonb) from public, anon;
grant execute on function public.get_vedeni_cena_t_trend(jsonb) to authenticated, service_role;

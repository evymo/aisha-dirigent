-- Data RPC for a 'chart' block (kind='bar'): cash-flow outlook — how much is due
-- to come IN over the next 30 days, bucketed by week, from unpaid issued invoices
-- whose dueDate falls ahead of today. This is the "what should land in the account"
-- line, deliberately SEPARATE from money already past due (that is get_vedeni_aging /
-- _overdue) — mixing the two would let overdue debt masquerade as expected inflow.
-- p_params->>'weeks' (default 4 → the horizon the owner plans wages and diesel on).
--
-- Reads document_registry (metadata contract: see get_vedeni_finance_kpi). Unpaid =
-- financial.paidDate IS NULL; due in [today, today + weeks·7). SECURITY INVOKER →
-- RLS fails closed. Contract: (jsonb) -> jsonb {data:{kind,unit_key,points[]}, provenance}.

-- ⭐ ČERSTVOST Z DAT (brána `cerstvost-z-dat`, 2026-09-27): `freshness_at` = nejnovější čas
-- univerza bloku, spočtený ze STEJNÝCH řádků jako hodnota. Pořadí zdrojů času: čas ze zdroje
-- (u Money `source_modified_at`, až bude úplný; u jízd/událostí `occurred_at`) › příchod verze
-- dokladu (`created_at`). NE `ingested_at`/`updated_at` — ty přepisuje KAŽDÝ import (naměřeno
-- 2026-09-27: 813 smluv = jediný čas), takže by lhaly jako faktury zamrzlé na exportu ze 6. 8.
-- Hranice `created_at`: backfill starých dokladů má čas dnešní — pravda o příchodu, ne o obsahu.
-- Prázdné univerzum → `trace_id` nese `:no_data` a čas je jen záloha `coalesce(…, now())`.
-- Stav linky (běží/neběží) sem NEPATŘÍ — je to jiný signál.
create or replace function public.get_vedeni_vyhled_inkasa(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with p as (
    select coalesce((p_params->>'weeks')::int, 4) as weeks,
           coalesce((p_params->>'days')::int, 30)  as horizon
  ),
  due as (
    select
      r.created_at as vznik,
      (r.metadata->'financial'->>'totalAmount')::numeric as total,
      (r.metadata->'financial'->>'dueDate')::date        as due
    from public.document_registry r
    where r.doc_type = 'invoice'
      and coalesce(r.metadata->>'direction','issued') = 'issued'
      and r.doc_date >= date '2024-01-01'
      and nullif(r.metadata->'financial'->>'paidDate','') is null
      and r.metadata->'financial'->>'totalAmount' ~ '^-?[0-9]+(\.[0-9]+)?$'
      and (r.metadata->'financial'->>'dueDate')::date >= current_date
      and (r.metadata->'financial'->>'dueDate')::date
            < current_date + (select horizon from p)
  ),
  -- Kostra týdnů (i prázdné) × naměřené sumy. Poslední koš pohltí zbytek horizontu
  -- (LEAST), takže „+3–4 týdny" pokrývá dny 22–30, ne jen jeden týden.
  weeks as (
    select gs as w from generate_series(0, (select weeks from p) - 1) gs
  ),
  agg as (
    select
      w.w,
      -- začátek/konec týdenního okna jako DATA (chart point label nemá i18n kanál);
      -- poslední koš končí na horizontu, ne po sedmi dnech.
      current_date + (w.w * 7)                                         as w_start,
      least(current_date + (w.w * 7) + 6,
            current_date + (select horizon from p) - 1)                as w_end,
      coalesce(sum(d.total) filter (
        where least((d.due - current_date) / 7, (select weeks from p) - 1) = w.w
      ), 0) as amount
    from weeks w
    left join due d on true
    group by w.w
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'kind', 'bar',
      'unit_key', 'app.vedeni.unit.czk',
      'points', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'label', to_char(w_start, 'DD.MM.') || '–' || to_char(w_end, 'DD.MM.'),
            'value', round(amount)
          ) order by w
        ) from agg
      ), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'money-s5',
      'freshness_at', to_char(coalesce((select max(vznik) from due), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'vedeni-vyhled-inkasa'
                      || case when (select max(vznik) from due) is null then ':no_data' else '' end
    )
  );
$$;

revoke all on function public.get_vedeni_vyhled_inkasa(jsonb) from public, anon;
grant execute on function public.get_vedeni_vyhled_inkasa(jsonb) to authenticated, service_role;

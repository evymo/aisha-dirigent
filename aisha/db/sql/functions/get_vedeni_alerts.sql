-- Data RPC for a 'findings' block: „Manažerské alerty" — deterministic leadership
-- findings DERIVED from the Money evidence substrate (not a passthrough read). Each
-- carries a catalogue rule id as title_key (i18n, never a literal) + severity +
-- grounded `fields` (the numbers that fired it). Three rules, all computable from
-- the metadata contract (see get_vedeni_finance_kpi):
--   • overdue_exposure — the counterparty with the largest past-due receivable,
--     when it clears p_params->>'exposure_min_czk' (500 000). Naming the biggest
--     hole is the first move before it becomes a write-off.
--   • old_receivable — any receivable past due beyond p_params->>'stale_days' (180):
--     a debt that old rarely pays itself; it needs a decision, not another reminder.
--   • customer_concentration — a single customer over p_params->>'concentration_pct'
--     (40) of trailing-year turnover: a dependency risk to see named, not buried.
-- Fakturační skluz (delivered-not-yet-invoiced) needs a delivery-note↔invoice match
-- this reader does not have and is left out rather than faked.
--
-- SECURITY INVOKER → RLS on document_registry fails closed. Contract:
-- (jsonb) -> jsonb {data:{items[]}, provenance}.

-- ⭐ ČERSTVOST Z DAT (brána `cerstvost-z-dat`, 2026-09-27): `freshness_at` = nejnovější čas
-- univerza bloku, spočtený ze STEJNÝCH řádků jako hodnota. Pořadí zdrojů času: čas ze zdroje
-- (u Money `source_modified_at`, až bude úplný; u jízd/událostí `occurred_at`) › příchod verze
-- dokladu (`created_at`). NE `ingested_at`/`updated_at` — ty přepisuje KAŽDÝ import (naměřeno
-- 2026-09-27: 813 smluv = jediný čas), takže by lhaly jako faktury zamrzlé na exportu ze 6. 8.
-- Hranice `created_at`: backfill starých dokladů má čas dnešní — pravda o příchodu, ne o obsahu.
-- Prázdné univerzum → `trace_id` nese `:no_data` a čas je jen záloha `coalesce(…, now())`.
-- Stav linky (běží/neběží) sem NEPATŘÍ — je to jiný signál.
create or replace function public.get_vedeni_alerts(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with p as (
    select coalesce((p_params->>'exposure_min_czk')::numeric, 500000) as exposure_min,
           coalesce((p_params->>'stale_days')::int, 180)              as stale_days,
           coalesce((p_params->>'concentration_pct')::numeric, 40)    as concentration_pct
  ),
  -- Neuhrazené vydané faktury (pohledávky) s validní částkou.
  recv as (
    select
      r.created_at as vznik,
      coalesce(nullif(r.counterparty,''), '—')           as party,
      (r.metadata->'financial'->>'totalAmount')::numeric as total,
      (r.metadata->'financial'->>'dueDate')::date        as due,
      r.doc_date
    from public.document_registry r
    where r.doc_type = 'invoice'
      and coalesce(r.metadata->>'direction','issued') = 'issued'
      and r.doc_date >= date '2024-01-01'
      and nullif(r.metadata->'financial'->>'paidDate','') is null
      and r.metadata->'financial'->>'totalAmount' ~ '^-?[0-9]+(\.[0-9]+)?$'
  ),
  -- ── overdue_exposure: největší expozice po splatnosti po odběratelích ──
  exposure as (
    select party, sum(total) as amount, max(current_date - due) as oldest
    from recv
    where due < current_date
    group by party
    having sum(total) >= (select exposure_min from p)
    order by sum(total) desc
    limit 1
  ),
  exposure_item as (
    select 'exposure:' || md5(party)                       as id,
           'app.vedeni.alert.overdue_exposure'             as title_key,
           'high'                                           as severity,
           jsonb_build_array(
             jsonb_build_object('key','party', 'label_key','app.vedeni.col.party',   'value', party),
             jsonb_build_object('key','amount','label_key','app.vedeni.col.overdue', 'value', round(amount)),
             jsonb_build_object('key','oldest','label_key','app.vedeni.col.oldest',  'value', oldest)
           )                                                as fields
    from exposure
  ),
  -- ── old_receivable: nejstarší jedna pohledávka za hranicí ──
  stale as (
    select party, total, current_date - due as days
    from recv
    where due < current_date - (select stale_days from p)
    order by due asc
    limit 1
  ),
  stale_item as (
    select 'stale:' || md5(party || days::text)            as id,
           'app.vedeni.alert.old_receivable'               as title_key,
           'high'                                           as severity,
           jsonb_build_array(
             jsonb_build_object('key','party', 'label_key','app.vedeni.col.party',   'value', party),
             jsonb_build_object('key','amount','label_key','app.vedeni.col.amount',  'value', round(total)),
             jsonb_build_object('key','oldest','label_key','app.vedeni.col.oldest',  'value', days)
           )                                                as fields
    from stale
  ),
  -- ── customer_concentration: podíl top odběratele na ročním obratu ──
  billed as (
    select r.created_at as vznik,
           coalesce(nullif(r.counterparty,''), '—') as party,
           (r.metadata->'financial'->>'totalAmount')::numeric as total
    from public.document_registry r
    where r.doc_type = 'invoice'
      and coalesce(r.metadata->>'direction','issued') = 'issued'
      and r.doc_date >= current_date - 365
      and r.metadata->'financial'->>'totalAmount' ~ '^-?[0-9]+(\.[0-9]+)?$'
  ),
  concentration as (
    select party, sum(total) as revenue,
           round(100.0 * sum(total) / nullif((select sum(total) from billed), 0)) as share
    from billed
    group by party
    order by sum(total) desc
    limit 1
  ),
  concentration_item as (
    select 'concentration:' || md5(party)                  as id,
           'app.vedeni.alert.customer_concentration'       as title_key,
           case when share >= 50 then 'high' else 'medium' end as severity,
           jsonb_build_array(
             jsonb_build_object('key','party', 'label_key','app.vedeni.col.party',   'value', party),
             jsonb_build_object('key','share', 'label_key','app.vedeni.col.share',   'value', share),
             jsonb_build_object('key','revenue','label_key','app.vedeni.col.revenue','value', round(revenue))
           )                                                as fields
    from concentration
    where share >= (select concentration_pct from p)
  ),
  items as (
    select * from exposure_item
    union all select * from stale_item
    union all select * from concentration_item
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object('id', id, 'title_key', title_key, 'severity', severity, 'fields', fields)
          order by case severity when 'high' then 1 when 'medium' then 2 else 3 end, id
        ) from items
      ), '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'money-s5',
      'freshness_at', to_char(coalesce(greatest((select max(vznik) from recv), (select max(vznik) from billed)), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'vedeni-alerts'
                      || case when greatest((select max(vznik) from recv), (select max(vznik) from billed)) is null then ':no_data' else '' end
    )
  );
$$;

revoke all on function public.get_vedeni_alerts(jsonb) from public, anon;
grant execute on function public.get_vedeni_alerts(jsonb) to authenticated, service_role;

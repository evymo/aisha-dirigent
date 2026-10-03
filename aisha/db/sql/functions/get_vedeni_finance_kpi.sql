-- Data RPC for a 'kpi_tile' block: one headline figure for the leadership console
-- (surface `vedeni`), over the EVIDENCE substrate the Money connector writes as
-- documents. The metric is chosen by p_params->>'metric' (seeded per block via
-- source_params). Window is p_params->>'days' (default 30 — the month the owner's
-- view is framed in); receivables/payables ignore the window (a debt is overdue
-- regardless of when the invoice was issued), the flow metrics honour it.
--
-- ── METADATA CONTRACT (document_registry.metadata) ──────────────────────────
-- The Money ingest maps each `DocumentRecord` onto register_source_document_audited
-- with this jsonb shape (the seam is invoice-mapping.ts; NOTHING here learns Money's
-- own field names). doc_type ∈ {'invoice','delivery_note'}, doc_date = issue date,
-- counterparty = AdresaNazev. metadata =
--   { "direction": "issued" | "received",          -- vydaná (pohledávka) / přijatá (závazek)
--     "financial": { "totalAmount": num,           -- SumaCelkem, incl. VAT
--                    "dueDate":  "YYYY-MM-DD",      -- DatumSplatnosti
--                    "paidDate": "YYYY-MM-DD"|null, -- DatumUhrady; NULL = NEUHRAZENO
--                    "currency": "CZK", … },         --   (sentinel 1753/0001 → null at the seam)
--     "lines": [ { "quantity": num, "unit": "t"|"x", -- t = kámen, x = doprava
--                  "lineTotal": num, "catalog": … } ] }
-- Until that ingest runs the table is empty, so every metric is legitimately
-- NEMĚŘENO (value=null → tile shows '—'), never a fabricated 0. `paidDate IS NULL`
-- is the ONLY reliable unpaid indicator — `status` (Money `Stav`) is always 0.
-- Older than 2024 is dropped: those are migration artifacts, not live receivables.
--
-- SECURITY INVOKER → RLS on document_registry fails closed (non-staff get an empty
-- figure, not an error), same doctrine as get_document_digest / get_fleet_kpi.
-- Contract: (jsonb) -> jsonb {data:{value,unit_key,state}, provenance}.

-- ⭐ ČERSTVOST Z DAT (brána `cerstvost-z-dat`, 2026-09-27): `freshness_at` = nejnovější čas
-- univerza bloku, spočtený ze STEJNÝCH řádků jako hodnota. Pořadí zdrojů času: čas ze zdroje
-- (u Money `source_modified_at`, až bude úplný; u jízd/událostí `occurred_at`) › příchod verze
-- dokladu (`created_at`). NE `ingested_at`/`updated_at` — ty přepisuje KAŽDÝ import (naměřeno
-- 2026-09-27: 813 smluv = jediný čas), takže by lhaly jako faktury zamrzlé na exportu ze 6. 8.
-- Hranice `created_at`: backfill starých dokladů má čas dnešní — pravda o příchodu, ne o obsahu.
-- Prázdné univerzum → `trace_id` nese `:no_data` a čas je jen záloha `coalesce(…, now())`.
-- Stav linky (běží/neběží) sem NEPATŘÍ — je to jiný signál.
create or replace function public.get_vedeni_finance_kpi(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with p as (
    select coalesce(nullif(p_params->>'metric',''), 'pohledavky') as m,
           coalesce((p_params->>'days')::int, 30)                 as days
  ),
  win as (select (now() - make_interval(days => (select days from p)))::date as since),
  -- Faktury s validní částkou; směr rozlišuje pohledávku (issued) od závazku (received).
  inv as (
    select
      r.created_at as vznik,
      coalesce(r.metadata->>'direction','issued')            as dir,
      (r.metadata->'financial'->>'totalAmount')::numeric     as total,
      (r.metadata->'financial'->>'dueDate')::date            as due,
      nullif(r.metadata->'financial'->>'paidDate','')::date  as paid,
      r.doc_date
    from public.document_registry r
    where r.doc_type = 'invoice'
      and r.doc_date >= date '2024-01-01'
      and r.metadata->'financial'->>'totalAmount' ~ '^-?[0-9]+(\.[0-9]+)?$'
  ),
  -- Řádky kamene (unit='t') na fakturách/dodacích listech — tuny a jejich hodnota.
  stone as (
    select
      r.created_at as vznik,
      r.doc_type,
      coalesce(r.metadata->>'direction','issued')  as dir,
      r.doc_date,
      (l->>'quantity')::numeric                     as qty,
      case when l->>'lineTotal' ~ '^-?[0-9]+(\.[0-9]+)?$'
           then (l->>'lineTotal')::numeric end      as line_total
    from public.document_registry r
    cross join lateral jsonb_array_elements(coalesce(r.metadata->'lines','[]'::jsonb)) l
    where r.doc_date >= (select since from win)
      and l->>'unit' = 't'
      and l->>'quantity' ~ '^-?[0-9]+(\.[0-9]+)?$'
  ),
  v as (
    select case (select m from p)
      -- ── Pohledávky (vydané, neuhrazené) ──
      when 'pohledavky' then
        (select sum(total) from inv where dir = 'issued' and paid is null)
      when 'pohledavky_po_splatnosti' then
        (select sum(total) from inv where dir = 'issued' and paid is null and due < current_date)
      -- ── Závazky (přijaté, neuhrazené) ──
      when 'zavazky' then
        (select sum(total) from inv where dir = 'received' and paid is null)
      when 'zavazky_po_splatnosti' then
        (select sum(total) from inv where dir = 'received' and paid is null and due < current_date)
      -- Čistá pozice = kolik nám dluží mínus kolik dlužíme.
      when 'cista_pozice' then
        (select coalesce(sum(total) filter (where dir='issued'  and paid is null), 0)
              - coalesce(sum(total) filter (where dir='received' and paid is null), 0)
           from inv)
      -- ── Tok (v okně) ──
      when 'vyfakturovano_30d' then
        (select sum(total) from inv where dir = 'issued' and doc_date >= (select since from win))
      -- DSO = pohledávky / (roční fakturace / 365). Bez fakturace = NEMĚŘENO.
      when 'dso' then
        (select case when a.rev > 0
                     then round(coalesce(o.open, 0) / (a.rev / 365.0))
                end
           from (select sum(total) rev from inv
                  where dir='issued' and doc_date >= current_date - 365) a,
                (select sum(total) open from inv where dir='issued' and paid is null) o)
      -- ── Materiál (řádky t) ──
      when 'vyvezeno_t' then
        (select sum(qty) from stone where doc_type = 'delivery_note' and dir = 'issued')
      when 'vyvezeno_hodnota' then
        (select sum(line_total) from stone where doc_type = 'invoice' and dir = 'issued')
      when 'fakturovano_t' then
        (select sum(qty) from stone where doc_type = 'invoice' and dir = 'issued')
      when 'cena_za_tunu' then
        (select case when sum(qty) > 0 then round(sum(line_total) / sum(qty))
                end from stone where doc_type = 'invoice' and dir = 'issued')
      -- Fakturační skluz = kolik z vyvezeného (dodací listy) ještě není na faktuře.
      when 'fakturacni_skluz_pct' then
        (select case when d.deliv > 0 then round(100.0 * (d.deliv - i.inv) / d.deliv) end
           from (select coalesce(sum(qty),0) deliv from stone where doc_type='delivery_note' and dir='issued') d,
                (select coalesce(sum(qty),0) inv   from stone where doc_type='invoice'       and dir='issued') i)
      else null
    end as value
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'value', (select value from v),
      'unit_key', case (select m from p)
        when 'vyvezeno_t'    then 'app.vedeni.unit.t'
        when 'fakturovano_t' then 'app.vedeni.unit.t'
        when 'cena_za_tunu'  then 'app.vedeni.unit.czk_t'
        when 'dso'           then 'app.vedeni.unit.days'
        when 'fakturacni_skluz_pct' then 'app.vedeni.unit.pct'
        else 'app.vedeni.unit.czk'
      end,
      'state', 'ok'
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'money-s5',
      'freshness_at', to_char(coalesce(greatest((select max(vznik) from inv), (select max(vznik) from stone)), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'vedeni-kpi:' || (select m from p)
                      || case when greatest((select max(vznik) from inv), (select max(vznik) from stone)) is null then ':no_data' else '' end
    )
  );
$$;

revoke all on function public.get_vedeni_finance_kpi(jsonb) from public, anon;
grant execute on function public.get_vedeni_finance_kpi(jsonb) to authenticated, service_role;

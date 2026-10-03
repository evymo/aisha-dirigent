-- ============================================================================
-- Source of Truth: get_counterparty_metric
-- Popis: blok `kpi_tile` — jedno číslo karty protistrany. Jeden RPC, víc
--        otázek: `metric` v source_params bloku.
--          receivable_open     K ÚHRADĚ: vystaveno (ve splatnosti) + po splatnosti − dobropisy
--          receivable_overdue  DLUH = po splatnosti (majitel 2026-09-26: dluhem je
--                              faktura po datu splatnosti); dobropis odečítá hned
--          oldest_overdue_days nejstarší dluh ve dnech po splatnosti
--          scheduled           PŘEDEPSÁNO: faktury, jejichž pohledávka teprve vznikne
--          invoiced_12m        vyfakturováno za [dnes − 365, dnes] (bez storna)
--        `receivable_from` v source_params: od kterého data je doklad
--        pohledávkou (výchozí datum vystavení — rozhodnutí majitele 2026-09-25).
-- Stav dokladu NEPOČÍTÁ tahle funkce — bere ho z invoice_state (jeden slovník
-- pro kartu, stáří, faktury odběratele i dlužníky). Naměřeno 2026-09-25 na
-- kartě Inspirace: faktury vystavené dopředu se sčítaly jako dluh
-- (588 383 Kč místo 259 597 Kč) a okno 12 m nemělo horní mez.
-- Pohledávky = JEN VYDANÉ faktury (document_subtype = issued). Změřeno
-- 2026-09-23: všech 268 faktur s dluhem po splatnosti je vydaných — přijatá
-- faktura je náš závazek, ne jeho dluh.
-- Stav dlaždice: po splatnosti > 0 → warning; nejstarší dluh > 365 dní → loss.
-- ⭐ NEZNÁMÉ ≠ 0 (majitel 2026-09-28): stav úhrady je SNÍMEK zdroje. Metriky
--    úhrady (receivable_open, receivable_overdue, oldest_overdue_days,
--    scheduled) se počítají jen z dokladů, k nimž zdroj stav dodal; když ho
--    nenese ŽÁDNÝ vydaný doklad protistrany, dlaždice je NEMĚŘENO (null, „—"),
--    ne 0 „ok". Naměřeno 2026-09-28: 929 protistran / 5 104 faktur bez jediného
--    stavu úhrady (export ERP bez zůstatku) hlásilo „K úhradě 0 Kč" a síť vazeb
--    „bez dluhu". Kolik dokladů stav nenese a z kdy, přizná hlavička karty
--    (counterparty_periods). invoiced_12m je součet vystavených částek — stav
--    úhrady nepotřebuje.
-- ⭐ ČERSTVOST Z DAT (brána `cerstvost-z-dat`, dohoda 2026-09-24 „opraví se v PR karty"):
--    `freshness_at` = nejnovější příchod verze dokladu (`created_at`) ve STEJNÉM univerzu
--    dokladů protistrany, ze kterého je hodnota — ne čas zavolání. Karta tak neřekne
--    „dnes", když poslední doklad té firmy dorazil před týdny. Prázdné univerzum →
--    `trace_id` nese `:no_data` a `now()` je jen záloha coalesce.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_counterparty_metric(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  with id as (select icos, names, twins, label from public.counterparty_resolve(p_params)),
  cfg as (select public.receivable_from_param(p_params) as od, public.storno_values_param(p_params) as storno),
  fa as (
    select
      public.invoice_state(d.fields, cfg.od, cfg.storno) as stav,
      case when d.fields->'amount_unpaid'->>'value' ~ '^-?[0-9]+(\.[0-9]+)?$'
           then (d.fields->'amount_unpaid'->>'value')::numeric end as zbyva,
      case when d.fields->'total_amount'->>'value' ~ '^-?[0-9]+(\.[0-9]+)?$'
           then (d.fields->'total_amount'->>'value')::numeric end as celkem,
      case when d.fields->'due_date'->>'value' ~ '^\d{4}-\d{2}-\d{2}$'
           then (d.fields->'due_date'->>'value')::date end as splatnost,
      case when d.fields->'issue_date'->>'value' ~ '^\d{4}-\d{2}-\d{2}$'
           then (d.fields->'issue_date'->>'value')::date end as vystaveno,
      d.created_at as vznik
    from id, cfg, public.counterparty_docs(id.icos, id.names, 'invoice') d
    where d.fields->'document_subtype'->>'value' = 'issued'
  ),
  m as (
    select
      sum(zbyva) filter (where stav in ('open', 'overdue', 'correction'))              as otevreno,
      sum(zbyva) filter (where stav in ('overdue', 'correction'))                      as po_splatnosti,
      max(current_date - splatnost) filter (where stav = 'overdue')                    as nejstarsi,
      sum(zbyva) filter (where stav = 'scheduled')                                     as predepsano,
      sum(celkem) filter (where stav <> 'storno'
                            and vystaveno between current_date - 365 and current_date) as za_rok,
      count(*) as dokladu,
      count(*) filter (where stav <> 'unknown') as se_stavem,
      max(vznik) as vznik
    from fa
  ),
  v as (
    select case p_params->>'metric'
             when 'receivable_open'     then round(coalesce(otevreno, 0))
             when 'receivable_overdue'  then round(coalesce(po_splatnosti, 0))
             when 'oldest_overdue_days' then coalesce(nejstarsi, 0)
             when 'scheduled'           then round(coalesce(predepsano, 0))
             when 'invoiced_12m'        then round(coalesce(za_rok, 0))
           end as hodnota,
           case when p_params->>'metric' = 'oldest_overdue_days' then 'app.units.days' else 'app.units.czk' end as jednotka,
           case when coalesce(nejstarsi, 0) > 365 and p_params->>'metric' in ('receivable_overdue','oldest_overdue_days') then 'loss'
                when coalesce(po_splatnosti, 0) > 0.005 and p_params->>'metric' in ('receivable_open','receivable_overdue','oldest_overdue_days') then 'warning'
                else 'ok' end as stav,
           dokladu, se_stavem, vznik
    from m
  )
  -- Klíče `data` DOSLOVNĚ (brána block-data-keys-fit-contract je čte ze zdroje):
  -- value null = NEMĚŘENO („—", ne nula) — protistrana bez vydaných faktur,
  -- nebo metrika úhrady nad doklady, z nichž ŽÁDNÝ stav úhrady nenese.
  select jsonb_build_object(
    'data', jsonb_build_object(
      'value', case when dokladu = 0 then null
                    when se_stavem = 0 and p_params->>'metric' <> 'invoiced_12m' then null
                    else hodnota end,
      'unit_key', jednotka,
      'state', stav),
    'provenance', jsonb_build_object(
      'source_slug', 'li-source-registry',
      'trace_id', 'counterparty-metric:' || coalesce(p_params->>'metric', '?')
                  || case when vznik is null then ':no_data' else '' end,
      'freshness_at', to_char(coalesce((vznik), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
  from v;
$$;

REVOKE ALL ON FUNCTION public.get_counterparty_metric(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_counterparty_metric(jsonb) TO authenticated, service_role;

-- ============================================================================
-- Source of Truth: get_counterparty_trend
-- Popis: blok `chart` (trend) — vyfakturováno protistraně po měsících (vydané
--        faktury podle data vystavení) a v `compare` z toho UHRAZENO
--        (celkem − zbývá). Jedna otázka („platí, co fakturujeme?"), dvě řady.
--        `months` v source_params (výchozí 24, strop 60). Měsíc bez faktury = 0,
--        aby osa času nelhala o mezerách.
-- ⚠ „Uhrazeno" je stav DNES u faktur vystavených v daném měsíci, ne platba
--   v tom měsíci — datum úhrady doklad nenese. Legenda to říká slovem.
-- ⭐ NEZNÁMÉ ≠ UHRAZENO (2026-09-28): „uhrazeno" = celkem − zbývá. Doklad, ke
--   kterému zdroj zůstatek NEDODAL, by s „zbývá = 0" vyšel jako plně uhrazený.
--   Nese-li kterákoli faktura v okně neznámý stav, druhá řada se NEVYDÁ (ani
--   její legenda): graf ukáže jen vyfakturováno, protože „platí, co
--   fakturujeme?" nad tím zodpovědět nejde. Kolik dokladů stav nenese, přizná
--   hlavička karty (counterparty_periods).
-- ⭐ ČERSTVOST Z DAT (brána `cerstvost-z-dat`, dohoda 2026-09-24 „opraví se v PR karty"):
--    `freshness_at` = nejnovější příchod verze dokladu (`created_at`) ve STEJNÉM univerzu
--    dokladů protistrany, ze kterého je hodnota — ne čas zavolání. Karta tak neřekne
--    „dnes", když poslední doklad té firmy dorazil před týdny. Prázdné univerzum →
--    `trace_id` nese `:no_data` a `now()` je jen záloha coalesce.
--    Univerzum trendu = VŠECHNY vydané faktury protistrany, ne jen okno: „v okně nic"
--    je tvrzení platné k poslednímu dokladu, který evidence o té firmě má.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_counterparty_trend(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  with id as (select icos, names, twins, label from public.counterparty_resolve(p_params)),
  cfg as (select least(greatest(coalesce(nullif(p_params->>'months', '')::int, 24), 3), 60) as m,
                public.receivable_from_param(p_params) as od,
                public.storno_values_param(p_params) as storno),
  mesice as (
    select to_char(date_trunc('month', current_date) - make_interval(months => g), 'YYYY-MM') as mes, g
      from cfg, generate_series(0, (select m from cfg) - 1) g
  ),
  -- Storno nebylo vyfakturováno; doklad s datem vystavení v budoucnu ještě ne
  -- (okno končí dneškem — stejně jako invoiced_12m v get_counterparty_metric).
  fa as (
    select left(d.fields->'issue_date'->>'value', 7) as mes,
           (d.fields->'total_amount'->>'value')::numeric as celkem,
           case when d.fields->'amount_unpaid'->>'value' ~ '^-?[0-9]+(\.[0-9]+)?$'
                then (d.fields->'amount_unpaid'->>'value')::numeric end as zbyva
    from id, cfg, public.counterparty_docs(id.icos, id.names, 'invoice') d
    where d.fields->'document_subtype'->>'value' = 'issued'
      -- CASE drží pořadí: přetypování až po regexu (AND pořadí nezaručuje)
      and case when d.fields->'issue_date'->>'value' ~ '^\d{4}-\d{2}-\d{2}$'
               then (d.fields->'issue_date'->>'value')::date end <= current_date
      and d.fields->'total_amount'->>'value' ~ '^-?[0-9]+(\.[0-9]+)?$'
      and public.invoice_state(d.fields, cfg.od, cfg.storno) <> 'storno'
  ),
  s as (
    select m.mes, m.g, round(coalesce(sum(fa.celkem), 0)) as fakt,
           round(coalesce(sum(fa.celkem - greatest(coalesce(fa.zbyva, 0), 0)), 0)) as uhr,
           count(fa.celkem) as n,
           count(fa.celkem) filter (where fa.zbyva is null) as bez_stavu
      from mesice m left join fa on fa.mes = m.mes
     group by m.mes, m.g
  ),
  -- druhá řada jen nad známým stavem úhrady všech faktur v okně
  srovnani as (select coalesce(sum(bez_stavu), 0) = 0 as lze from s),
  cas as (
    select max(d.created_at) as vznik
      from id, public.counterparty_docs(id.icos, id.names, 'invoice') d
     where d.fields->'document_subtype'->>'value' = 'issued'
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'kind', 'trend',
      'unit_key', 'app.units.czk',
      'legend_keys', case when (select lze from srovnani)
                          then jsonb_build_array('app.cp.trend.invoiced', 'app.cp.trend.paid')
                          else jsonb_build_array('app.cp.trend.invoiced') end,
      -- bez jediné faktury v okně je graf prázdný (JAZYK-03), ne řada nul
      'points', case when (select sum(n) from s) = 0 then '[]'::jsonb else
        (select jsonb_agg(jsonb_build_object('label', mes, 'value', fakt) order by g desc) from s) end,
      'compare', case when (select sum(n) from s) = 0 or not (select lze from srovnani) then '[]'::jsonb else
        (select jsonb_agg(jsonb_build_object('label', mes, 'value', uhr) order by g desc) from s) end),
    'provenance', jsonb_build_object(
      'source_slug', 'li-source-registry',
      'trace_id', 'counterparty-trend' || case when (select vznik from cas) is null then ':no_data' else '' end,
      'freshness_at', to_char(coalesce((select vznik from cas), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
$$;

REVOKE ALL ON FUNCTION public.get_counterparty_trend(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_counterparty_trend(jsonb) TO authenticated, service_role;

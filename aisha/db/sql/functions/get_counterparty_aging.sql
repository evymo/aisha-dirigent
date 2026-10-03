-- ============================================================================
-- Source of Truth: get_counterparty_aging
-- Popis: blok `chart` (bar) — kolik protistrana dluží podle STÁŘÍ dluhu:
--        ještě nesplatné · 1–30 · 31–90 · 91–365 · přes rok (dní po splatnosti).
--        Hodnota = Kč (amount_unpaid vydaných faktur), stav pásma: ok → warning
--        → loss. Pásmo bez dluhu se NEKRESLÍ (JAZYK-03), pořadí je stáří.
--        Co dnes dluží, rozhoduje invoice_state (předepsané a storno mimo).
-- Popisek pásma je číselný rozsah (jazykově neutrální); „nesplatné" nese
-- `label_key`, protože slovo se překládá.
-- ⭐ ČERSTVOST Z DAT (brána `cerstvost-z-dat`, dohoda 2026-09-24 „opraví se v PR karty"):
--    `freshness_at` = nejnovější příchod verze dokladu (`created_at`) ve STEJNÉM univerzu
--    dokladů protistrany, ze kterého je hodnota — ne čas zavolání. Karta tak neřekne
--    „dnes", když poslední doklad té firmy dorazil před týdny. Prázdné univerzum →
--    `trace_id` nese `:no_data` a `now()` je jen záloha coalesce.
--    Univerzum = VŠECHNY vydané faktury protistrany: prázdné pásmo („nedluží")
--    je tvrzení platné k poslednímu dokladu, ne jen k otevřeným.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_counterparty_aging(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  with id as (select icos, names, twins, label from public.counterparty_resolve(p_params)),
  cfg as (select public.receivable_from_param(p_params) as od, public.storno_values_param(p_params) as storno),
  -- Jen doklady, které DNES dluží (invoice_state: vystaveno / po splatnosti).
  -- Předepsané (pohledávka teprve vznikne), storno a dobropis stáří nemají.
  fa as (
    select (d.fields->'amount_unpaid'->>'value')::numeric as zbyva,
           case when d.fields->'due_date'->>'value' ~ '^\d{4}-\d{2}-\d{2}$'
                then current_date - (d.fields->'due_date'->>'value')::date end as dni
    from id, cfg, public.counterparty_docs(id.icos, id.names, 'invoice') d
    where d.fields->'document_subtype'->>'value' = 'issued'
      and public.invoice_state(d.fields, cfg.od, cfg.storno) in ('open', 'overdue')
  ),
  pasma(poradi, label, label_key, od, do_, stav) as (values
    (1, '≤ 0',   'app.cp.aging.not_due', null::int, 0,    'ok'),
    (2, '1–30',   null,                   1,         30,   'warning'),
    (3, '31–90',  null,                   31,        90,   'warning'),
    (4, '91–365', null,                   91,        365,  'loss'),
    (5, '365+',   null,                   366,       null, 'loss')
  ),
  s as (
    select p.poradi, p.label, p.label_key, p.stav, round(sum(fa.zbyva)) as castka, count(*) as n
      from pasma p join fa
        -- faktura BEZ splatnosti do žádného pásma nepatří (stáří neznáme) —
        -- přiřadit ji „nesplatným" by byl vymyšlený údaj
        on fa.dni is not null
       and fa.dni >= coalesce(p.od, -100000) and fa.dni <= coalesce(p.do_, 100000)
     group by 1, 2, 3, 4
  ),
  celkem as (select sum(castka) c from s),
  cas as (
    select max(d.created_at) as vznik
      from id, public.counterparty_docs(id.icos, id.names, 'invoice') d
     where d.fields->'document_subtype'->>'value' = 'issued'
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'kind', 'bar',
      'unit_key', 'app.units.czk',
      'points', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                  'label', s.label, 'label_key', s.label_key, 'value', s.castka,
                  'pct', round(100 * s.castka / nullif((select c from celkem), 0), 1),
                  'state', s.stav)) order by s.poradi) from s), '[]'::jsonb)),
    'provenance', jsonb_build_object(
      'source_slug', 'li-source-registry',
      'trace_id', 'counterparty-aging' || case when (select vznik from cas) is null then ':no_data' else '' end,
      'freshness_at', to_char(coalesce((select vznik from cas), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
$$;

REVOKE ALL ON FUNCTION public.get_counterparty_aging(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_counterparty_aging(jsonb) TO authenticated, service_role;

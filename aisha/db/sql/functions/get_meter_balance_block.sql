-- ============================================================================
-- Source of Truth: get_meter_balance_block
-- Popis: 'table' blok — BILANCE hlavního měřidla proti součtu podružných po
--        obdobích: sedí spotřeba na podružných měřidlech s tím, co naměřilo
--        (a vyfakturovalo) hlavní? Majitel 2026-09-28: „chceme vidět, zda součty
--        na podružných měřidlech odpovídají hlavnímu měřidlu".
--
-- Rozsah = JEDNO hlavní měřidlo (p_params->>'twin_id' z detail_by_kind), jako
-- karta dvojčete: blok o jednom záznamu nesmí číst svět.
--
-- Konfigurace (source_params bloku — slovník je instanční, ne platformní):
--   relation_kind      POVINNÉ  druh hrany podružné —kind→ hlavní (např. submeter_of)
--   consumption_event  POVINNÉ  event_type spotřeby HLAVNÍHO měřidla za období
--                              (attrs {period 'YYYY-MM', value, unit})
--   multiplier_path    volitelné cesta k násobiteli v metadatech podružného
--                              (např. ["energie","nasobitel"]); bez ní 1
--   residual_path      volitelné cesta k seznamu dopočtových řádků v metadatech
--                              hlavního (neprázdný = rozdíl vychází nulový Z PRINCIPU)
--
-- ⭐ PODRUŽNÁ JEN PŘES POTVRZENÉ HRANY (twin_relations). Návrh vazby, o kterém
-- ještě nikdo nerozhodl, do bilance nevstupuje — jinak by bilance tvrdila
-- strukturu, kterou člověk neschválil. Hrana musí platit v daném období.
--
-- ⭐ SPOTŘEBA SE POČÍTÁ Z ODEČTŮ (event_type 'meter_reading', tatáž veličina jako
-- terénní odečet): konec období − počátek období, kde počátek je výslovný
-- odečet 'pocatek' (výměna měřidla, první měsíc), jinak konec předchozího
-- období; krát násobitel. Odečet bez `period` do bilance nevstupuje — neví se,
-- kam patří (hlásí se jako chybějící, ne jako nula).
--
-- STAV řádku (klíč app.meters.balance.state.*, sloupec value_keys) říká, JAK
-- rozdíl číst — bilance bez něj svádí k závěru i tam, kde žádný není:
--   no_submeters     pod měřidlem není potvrzené podružné
--   no_main          hlavní za období nemá spotřebu
--   unit_mismatch    jednotky hlavního a podružných se liší (nepřepočítává se)
--   missing_readings některému podružnému chybí odečet → součet je neúplný
--   residual         hlavní má dopočtový řádek → rozdíl je nulový z principu
--   measured         změřená bilance
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_meter_balance_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
-- INVOKER: dvojčata, hrany i události čte RLS (admin/staff), jako karta dvojčete.
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  with cfg as (
    select case
             when coalesce(p_params->>'twin_id', '')
                  ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then (p_params->>'twin_id')::uuid
           end                                              as twin,
           nullif(p_params->>'relation_kind', '')           as kind,
           nullif(p_params->>'consumption_event', '')       as cons_ev,
           coalesce(array(select jsonb_array_elements_text(
             case when jsonb_typeof(p_params->'multiplier_path') = 'array'
                  then p_params->'multiplier_path' else '[]'::jsonb end)), '{}'::text[]) as mult_path,
           coalesce(array(select jsonb_array_elements_text(
             case when jsonb_typeof(p_params->'residual_path') = 'array'
                  then p_params->'residual_path' else '[]'::jsonb end)), '{}'::text[]) as resid_path
  ),
  sloupce as (
    select jsonb_build_array(
      jsonb_build_object('key', 'obdobi',     'label_key', 'app.meters.balance.col.period'),
      jsonb_build_object('key', 'jednotka',   'label_key', 'app.meters.balance.col.unit'),
      jsonb_build_object('key', 'hlavni',     'label_key', 'app.meters.balance.col.main', 'align', 'right'),
      jsonb_build_object('key', 'podruzne',   'label_key', 'app.meters.balance.col.submeters', 'align', 'right'),
      jsonb_build_object('key', 'rozdil',     'label_key', 'app.meters.balance.col.difference', 'align', 'right'),
      jsonb_build_object('key', 'rozdil_pct', 'label_key', 'app.meters.balance.col.difference_pct', 'align', 'right'),
      jsonb_build_object('key', 'chybi',      'label_key', 'app.meters.balance.col.missing', 'align', 'right'),
      jsonb_build_object('key', 'stav',       'label_key', 'app.meters.balance.col.state', 'value_keys', true)
    ) as c
  ),
  hlavni as (
    select t.id, t.metadata from twin_entities t, cfg where t.id = cfg.twin
  ),
  dopocet as (
    select coalesce(jsonb_typeof(h.metadata #> (select resid_path from cfg)) = 'array'
                    and jsonb_array_length(h.metadata #> (select resid_path from cfg)) > 0, false) as ano
      from hlavni h
     where cardinality((select resid_path from cfg)) > 0
  ),
  podruzna as (
    select r.source_twin_id as id, r.valid_from, r.valid_to,
           coalesce(nullif(s.metadata #>> (select mult_path from cfg), '')::numeric, 1) as nas
      from twin_relations r
      join twin_entities s on s.id = r.source_twin_id
      join cfg on r.target_twin_id = cfg.twin and r.relation_kind = cfg.kind
  ),
  -- Jeden odečet na (měřidlo, období, druh): při souběhu platí poslední pořízený.
  odecty as (
    select distinct on (e.twin_id, e.attrs->>'period', e.attrs->>'kind')
           e.twin_id, e.attrs->>'period' as per, e.attrs->>'kind' as druh,
           (e.attrs->>'value')::numeric as v, e.attrs->>'unit' as j, e.occurred_at
      from twin_events e
      join podruzna p on p.id = e.twin_id
     where e.event_type = 'meter_reading'
       and e.attrs->>'period' ~ '^\d{4}-\d{2}$'
       and jsonb_typeof(e.attrs->'value') = 'number'
     order by e.twin_id, e.attrs->>'period', e.attrs->>'kind', e.occurred_at desc, e.id
  ),
  spotreba_hl as (
    select e.attrs->>'period' as per, sum((e.attrs->>'value')::numeric) as v,
           min(e.attrs->>'unit') as j, count(distinct e.attrs->>'unit') as jednotek,
           max(e.occurred_at) as fresh
      from twin_events e, cfg
     where e.twin_id = cfg.twin and e.event_type = cfg.cons_ev
       and e.attrs->>'period' ~ '^\d{4}-\d{2}$'
       and jsonb_typeof(e.attrs->'value') = 'number'
     group by e.attrs->>'period'
  ),
  obdobi as (
    select per from odecty where druh = 'konec'
    union
    select per from spotreba_hl
  ),
  spotreba_pod as (
    select o.per, p.id,
           (k.v - coalesce(z.v, pk.v)) * p.nas as sp,
           coalesce(k.j, z.j) as j
      from obdobi o
      cross join podruzna p
      left join odecty k  on k.twin_id = p.id and k.per = o.per and k.druh = 'konec'
      left join odecty z  on z.twin_id = p.id and z.per = o.per and z.druh = 'pocatek'
      left join odecty pk on pk.twin_id = p.id and pk.druh = 'konec'
                         and pk.per = to_char(to_date(o.per, 'YYYY-MM') - interval '1 month', 'YYYY-MM')
     -- hrana musí platit v období (osa B: příslušnost k datu)
     where p.valid_from < (to_date(o.per, 'YYYY-MM') + interval '1 month')
       and (p.valid_to is null or p.valid_to > to_date(o.per, 'YYYY-MM'))
  ),
  bilance as (
    select o.per,
           h.v as hlavni, h.j as j_hl, h.jednotek as jednotek_hl,
           (select sum(s.sp) from spotreba_pod s where s.per = o.per) as podruzne,
           (select count(*) from spotreba_pod s where s.per = o.per) as podruznych,
           (select count(*) from spotreba_pod s where s.per = o.per and s.sp is null) as chybi,
           (select count(distinct s.j) from spotreba_pod s where s.per = o.per and s.j is not null) as jednotek_pod,
           (select min(s.j) from spotreba_pod s where s.per = o.per) as j_pod
      from obdobi o
      left join spotreba_hl h on h.per = o.per
  ),
  -- Čerstvost = nejnovější odečet nebo spotřeba, ze kterých bilance vznikla
  -- (brána cerstvost-z-dat): čas zavolání funkce by o stáří dat lhal.
  cerstvost as (
    select greatest((select max(occurred_at) from odecty), (select max(fresh) from spotreba_hl)) as fresh
  ),
  radky as (
    select b.per,
           jsonb_build_object(
             'id',         b.per,
             'obdobi',     b.per,
             'jednotka',   coalesce(b.j_hl, b.j_pod),
             'hlavni',     round(b.hlavni, 3),
             'podruzne',   round(b.podruzne, 3),
             'rozdil',     round(b.hlavni - b.podruzne, 3),
             'rozdil_pct', case when b.hlavni is not null and b.hlavni <> 0 and b.podruzne is not null
                                then round(100 * (b.hlavni - b.podruzne) / b.hlavni, 1) end,
             'chybi',      b.chybi,
             'stav', 'app.meters.balance.state.' || case
                when b.podruznych = 0                                        then 'no_submeters'
                when b.hlavni is null                                        then 'no_main'
                when b.jednotek_hl > 1 or b.jednotek_pod > 1
                  or b.j_hl is distinct from b.j_pod                         then 'unit_mismatch'
                when b.chybi > 0                                             then 'missing_readings'
                when coalesce((select ano from dopocet), false)              then 'residual'
                else 'measured' end
           ) as r
      from bilance b
  )
  select case
    -- Bez nároku nebo bez konfigurace: platná prázdná tabulka (maska table
    -- prázdno připouští — „nic tu není" je poctivější než vymyšlená hlavička).
    -- Odmítací větve žádná data nemají, důvod nese literál v trace_id.
    when not (public.is_admin_or_staff() or public.is_service_role())
    then jsonb_build_object(
      'data', jsonb_build_object('columns', '[]'::jsonb, 'rows', '[]'::jsonb),
      'provenance', jsonb_build_object('source_slug', 'meter-balance',
        'trace_id', 'meter-balance:unauthorized', 'freshness_at', now()))
    when (select twin from cfg) is null
      or (select kind from cfg) is null
      or (select cons_ev from cfg) is null
    then jsonb_build_object(
      'data', jsonb_build_object('columns', '[]'::jsonb, 'rows', '[]'::jsonb),
      'provenance', jsonb_build_object('source_slug', 'meter-balance',
        'trace_id', 'meter-balance:missing_config', 'freshness_at', now()))
    else jsonb_build_object(
      'data', jsonb_build_object(
        'columns', (select c from sloupce),
        'rows', coalesce((select jsonb_agg(r order by per desc) from radky), '[]'::jsonb),
        'row_kind', 'meter_period'),
      'provenance', jsonb_build_object('source_slug', 'meter-balance',
        'trace_id', 'meter-balance:' || (select twin from cfg)::text
                    || case when (select fresh from cerstvost) is null then ':no_data' else '' end,
        'freshness_at', coalesce((select fresh from cerstvost), now())))
  end;
$$;

REVOKE ALL ON FUNCTION public.get_meter_balance_block(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_meter_balance_block(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_meter_balance_block(jsonb) TO service_role;

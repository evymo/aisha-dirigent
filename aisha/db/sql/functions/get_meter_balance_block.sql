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
--   reading_rule       volitelné jak se odvodí stav podružného k hranici období, když k ní
--                              není přesný odečet: 'linearne' (výchozí) | 'posledni_pred' |
--                              'presny' — viz meter_usage_between; jiná hodnota = bad_config
--   tz                 volitelné pásmo, ve kterém období začíná a končí (výchozí 'UTC',
--                              jako bloky twin_metric_*); instance s odečty o místní půlnoci
--                              ho MUSÍ deklarovat, jinak hranice minou odečty o hodinu–dvě
--
-- ⭐ PODRUŽNÁ JEN PŘES POTVRZENÉ HRANY (twin_relations). Návrh vazby, o kterém
-- ještě nikdo nerozhodl, do bilance nevstupuje — jinak by bilance tvrdila
-- strukturu, kterou člověk neschválil. Hrana musí platit v daném období.
--
-- ⭐ ODEČET JE HODNOTA K DATU, ROLI ODVOZUJE BILANCE (majitel 2026-10-04: „je to prostě
-- odečet k datu; jak a kam vstupuje, jsou věci vždy dynamické, odvozené v čase“).
-- Spotřeba podružného za období = stav k jeho konci − stav k jeho počátku, odvozené
-- z odečtů (event_type 'meter_reading', jakýkoli zdroj — sešit, terén, IoT) funkcí
-- meter_usage_between podle `reading_rule`; krát násobitel. Přesný odečet k hranici má
-- přednost; odvozený stav je ODHAD a řádek to řekne (sloupec `odhad`, stav estimated).
-- Výměna měřidla (`kind = 'pocatek'` uprostřed řady) není spotřeba. Mimo rozsah odečtů se
-- neextrapoluje — chybí. Nálepka `period` na odečtu (import sešitu) se NEČTE: odečty ze
-- sešitu leží přesně na hranicích (místní půlnoc), takže dávají totéž jako dřív.
--
-- (do 2026-10-04 bilance četla jen odečty s nálepkou `period`/`kind` — terénní odečet,
-- který je nenese, do ní nikdy nevstoupil: mezera G3 návrhu vyúčtování energií.)
--
-- STAV řádku (klíč app.meters.balance.state.*, sloupec value_keys) říká, JAK
-- rozdíl číst — bilance bez něj svádí k závěru i tam, kde žádný není:
--   no_submeters     pod měřidlem není potvrzené podružné
--   no_main          hlavní za období nemá spotřebu
--   unit_mismatch    jednotky hlavního a podružných se liší (nepřepočítává se)
--   missing_readings některému podružnému chybí odečet → součet je neúplný
--   estimated        stav některého podružného k hranici je odvozený (odhad) → součet platí
--                    s přesností odhadu (sloupec `odhad` = kolik podružných)
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
                  then p_params->'residual_path' else '[]'::jsonb end)), '{}'::text[]) as resid_path,
           coalesce(nullif(btrim(coalesce(p_params->>'reading_rule', '')), ''), 'linearne') as pravidlo,
           coalesce(nullif(btrim(coalesce(p_params->>'tz', '')), ''), 'UTC') as tz
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
      jsonb_build_object('key', 'odhad',      'label_key', 'app.meters.balance.col.estimated', 'align', 'right'),
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
           -- Bez `multiplier_path` násobitel 1 (hlavička). ⛔ Prázdná cesta NESMÍ do `#>>`:
           -- `metadata #>> '{}'` vrátí CELÝ objekt jako text a `::numeric` spadne (naměřeno
           -- 2026-10-04 testem odecet-nese-obdobi — dosavadní test cestu vždy předával).
           case when cardinality((select mult_path from cfg)) = 0 then 1
                else coalesce(nullif(s.metadata #>> (select mult_path from cfg), '')::numeric, 1)
           end as nas
      from twin_relations r
      join twin_entities s on s.id = r.source_twin_id
      join cfg on r.target_twin_id = cfg.twin and r.relation_kind = cfg.kind
  ),
  -- Odečty podružných (jakýkoli zdroj) — jen pro výčet období a čerstvost; spotřebu
  -- odvozuje meter_usage_between z odečtů K DATU.
  odecty as (
    select e.twin_id, e.occurred_at,
           e.occurred_at = min(e.occurred_at) over (partition by e.twin_id) as prvni
      from twin_events e
      join podruzna p on p.id = e.twin_id
     where e.event_type = 'meter_reading'
       and jsonb_typeof(e.attrs->'value') = 'number'
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
  -- Období = měsíce spotřeby hlavního ∪ měsíce, které odečet podružného UZAVÍRÁ nebo do
  -- kterých padá (v pásmu bloku; odečet přesně o půlnoci 1. dne uzavírá PŘEDCHOZÍ měsíc).
  -- První odečet měřidla období nezakládá — před ním není co uzavírat (jinak by import
  -- sešitu s počátky k 1. 1. vyrobil prázdný řádek za prosinec).
  obdobi as (
    select distinct to_char((o.occurred_at at time zone (select tz from cfg)) - interval '1 microsecond', 'YYYY-MM') as per
      from odecty o
     where not o.prvni
    union
    select per from spotreba_hl
  ),
  hranice as (
    select o.per,
           (to_date(o.per, 'YYYY-MM')::timestamp at time zone (select tz from cfg))                       as od,
           ((to_date(o.per, 'YYYY-MM') + interval '1 month')::timestamp at time zone (select tz from cfg)) as do_
      from obdobi o
  ),
  spotreba_pod as (
    select x.per, x.id,
           (x.u->>'spotreba')::numeric * x.nas as sp,
           x.u->>'jednotka' as j,
           coalesce((x.u->>'odhad')::boolean, false) and not coalesce((x.u->>'chybi')::boolean, true) as odhad
      from (
        select h.per, p.id, p.nas,
               public.meter_usage_between(p.id, h.od, h.do_, (select pravidlo from cfg)) as u
          from hranice h
          cross join podruzna p
         -- hrana musí platit v období (osa B: příslušnost k datu)
         where p.valid_from < h.do_
           and (p.valid_to is null or p.valid_to > h.od)
      ) x
  ),
  bilance as (
    select o.per,
           h.v as hlavni, h.j as j_hl, h.jednotek as jednotek_hl,
           (select sum(s.sp) from spotreba_pod s where s.per = o.per) as podruzne,
           (select count(*) from spotreba_pod s where s.per = o.per) as podruznych,
           (select count(*) from spotreba_pod s where s.per = o.per and s.sp is null) as chybi,
           (select count(*) from spotreba_pod s where s.per = o.per and s.odhad) as odhadu,
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
             'odhad',      b.odhadu,
             'stav', 'app.meters.balance.state.' || case
                when b.podruznych = 0                                        then 'no_submeters'
                when b.hlavni is null                                        then 'no_main'
                when b.jednotek_hl > 1 or b.jednotek_pod > 1
                  or b.j_hl is distinct from b.j_pod                         then 'unit_mismatch'
                when b.chybi > 0                                             then 'missing_readings'
                when b.odhadu > 0                                            then 'estimated'
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
    -- Pravidlo nebo pásmo v datech JE, ale nejde použít → vadná konfigurace (ne tichý výchozí).
    when (select pravidlo from cfg) not in ('presny', 'posledni_pred', 'linearne')
      or not exists (select 1 from pg_timezone_names z where z.name = (select tz from cfg))
    then jsonb_build_object(
      'data', jsonb_build_object('columns', '[]'::jsonb, 'rows', '[]'::jsonb),
      'provenance', jsonb_build_object('source_slug', 'meter-balance',
        'trace_id', 'meter-balance:bad_config', 'freshness_at', now()))
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

-- AKTUÁLNÍ NÁJEM — DERIVOVANÝ Z DOKLADŮ, ne držený v seedu.
--
-- ⛔ PROČ VZNIKLA
-- Nájem žil jako 33 `lease` událostí nasypaných seedem z jednorázového exportu.
-- Naměřeno 2026-08-03 proti vydaným fakturám v korpusu:
--   · pole se jmenovalo `annual_rent_czk`, ale hodnota byla MĚSÍČNÍ — 25 z 33
--     sedělo 1:1 na jednu měsíční fakturu (BRIMS 116 736 Kč fakturováno 12×/rok).
--     Odpovídač to hlásil jako roční a měsíční dopočítával /12: obě čísla lhala
--     o řád.
--   · 21 z těch 25 částek už NEPLATILO (valorizace od 02/2026).
--   · faktury znaly 101 plátců nájmu, seed 33.
-- Seed byl tedy ROZHODNUTÍ VYDÁVANÉ ZA MĚŘENÍ. Tahle funkce ho nahrazuje
-- derivací z toho, co se skutečně fakturuje.
--
-- ⭐ KLASIFIKACE JE DATA (týž kontrakt jako get_rent_breakdown)
-- Které texty řádků znamenají nájem, je vlastnost PODNIKU. Vzory přicházejí
-- v `p_params.rent_patterns`; bez nich funkce vrátí PRÁZDNO a řekne proč —
-- prázdný katalog není důvod něco si domyslet.
--
-- ⭐ AKTUÁLNOST JE INTERVAL, NE PŘÍZNAK
-- „Kolik platí" má odpověď jen K DATU. Bere se poslední měsíc, ve kterém má
-- nájemce fakturovanou položku nájmu; nájemce je AKTIVNÍ, když ten měsíc spadá
-- do `active_months` zpět od nejnovějšího měsíce v datech (ne od dneška —
-- korpus může být starší a datum stroje není fakt o podniku).
--
-- ⚠️ MĚSÍČNÍ, a je to v NÁZVU pole. Roční se dopočítá ×12 jen tam, kde to
-- volající výslovně chce; funkce sama žádné roční číslo nevydává, aby se
-- nemohla zopakovat vada, kvůli které vznikla.
--
-- Konfigurace (p_params):
--   rent_patterns : text[] | text — regex(y) pro řádky nájmu (case-insensitive)
--   exclude_owner : text — vlastní firma, jejíž doklady se vynechají (jiný podnik)
--   active_months : int (default 2) — kolik měsíců zpět se počítá za aktivní
--   limit         : int (default 200, strop 1000)
--
-- SECURITY INVOKER → RLS rozhoduje; bez nároku prázdno, ne chyba.
-- Kontrakt: (jsonb) -> jsonb {data:{tenants[], summary{}}, provenance}.

-- ⭐ ČERSTVOST Z DAT (brána `cerstvost-z-dat`, 2026-09-27): `freshness_at` = nejnovější čas
-- univerza bloku, spočtený ze STEJNÝCH řádků jako hodnota. Pořadí zdrojů času: čas ze zdroje
-- (u Money `source_modified_at`, až bude úplný; u jízd/událostí `occurred_at`) › příchod verze
-- dokladu (`created_at`). NE `ingested_at`/`updated_at` — ty přepisuje KAŽDÝ import (naměřeno
-- 2026-09-27: 813 smluv = jediný čas), takže by lhaly jako faktury zamrzlé na exportu ze 6. 8.
-- Hranice `created_at`: backfill starých dokladů má čas dnešní — pravda o příchodu, ne o obsahu.
-- Prázdné univerzum → `trace_id` nese `:no_data` a čas je jen záloha `coalesce(…, now())`.
-- Stav linky (běží/neběží) sem NEPATŘÍ — je to jiný signál.
create or replace function public.get_rent_current(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with cfg as (
    select
      -- Vzory: pole NEBO jeden řetězec; spojí se do jedné alternace.
      coalesce(
        nullif(array_to_string(
          array(select jsonb_array_elements_text(
                  case when jsonb_typeof(p_params->'rent_patterns') = 'array'
                       then p_params->'rent_patterns' else '[]'::jsonb end)), '|'), ''),
        nullif(p_params->>'rent_patterns', '')
      )                                                              as vzor,
      nullif(p_params->>'exclude_owner','')                          as mimo,
      greatest(coalesce(nullif(p_params->>'active_months','')::int, 2), 1) as mesicu,
      least(coalesce(nullif(p_params->>'limit','')::int, 200), 1000) as lim
  ),
  -- Řádky nájmu s obdobím z data vystavení dokladu.
  radky as (
    select
      r.created_at as vznik,
      r.fields->'counterparty'->>'value'                as najemce,
      left(r.fields->'issue_date'->>'value', 7)         as obdobi,
      (li->'fields'->'line_total'->>'value')::numeric   as castka
    from public.li_source_registry r
    cross join cfg
    cross join lateral jsonb_array_elements(coalesce(r.line_items, '[]'::jsonb)) li
    where cfg.vzor is not null
      and r.superseded_by is null
      and r.doc_type = 'invoice'
      and (cfg.mimo is null or coalesce(r.fields->'owner_company'->>'value','') <> cfg.mimo)
      and nullif(r.fields->'counterparty'->>'value','') is not null
      and length(coalesce(r.fields->'issue_date'->>'value','')) >= 7
      and li->'fields'->'item_name'->>'value' ~* cfg.vzor
      and (li->'fields'->'line_total'->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
      and (li->'fields'->'line_total'->>'value')::numeric > 0
  ),
  -- Součet za nájemce a měsíc: jeden nájemce může mít v měsíci víc řádků
  -- (víc pronajatých jednotek) a všechny jsou jeho nájem.
  za_mesic as (
    select najemce, obdobi, sum(castka) as castka
    from radky group by 1,2
  ),
  posledni_v_datech as (select max(obdobi) as m from za_mesic),
  -- Poslední měsíc KAŽDÉHO nájemce = jeho aktuální nájem.
  aktualni as (
    select distinct on (najemce) najemce, obdobi, castka
    from za_mesic order by najemce, obdobi desc
  ),
  oznaceni as (
    select a.*,
           a.obdobi >= to_char(
             (to_date((select m from posledni_v_datech), 'YYYY-MM')
              - ((select mesicu from cfg) - 1) * interval '1 month'), 'YYYY-MM') as aktivni
    from aktualni a
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'tenants', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'tenant', o.najemce, 'monthly_amount', o.castka,
                 'period', o.obdobi, 'active', o.aktivni)
               order by o.aktivni desc, o.castka desc)
        from (select * from oznaceni order by aktivni desc, castka desc
              limit (select lim from cfg)) o), '[]'::jsonb),
      'summary', jsonb_build_object(
        'active_tenants',   (select count(*) from oznaceni where aktivni),
        'known_tenants',    (select count(*) from oznaceni),
        'monthly_amount',      coalesce((select sum(castka) from oznaceni where aktivni), 0),
        'period',           (select m from posledni_v_datech),
        -- Bez vzorů se NIC nederivuje a musí to být vidět: prázdná odpověď
        -- z prázdné konfigurace vypadá stejně jako „podnik nemá nájemce".
        'configured',       (select vzor is not null from cfg))
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'li-source-registry:line-items',
      'freshness_at', to_char(coalesce((select max(vznik) from radky), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'rent-current'
                      || case when (select max(vznik) from radky) is null then ':no_data' else '' end)
  );
$$;

comment on function public.get_rent_current(jsonb) is
  'Aktuální MĚSÍČNÍ nájem derivovaný z fakturovaných položek (li_source_registry.line_items) — nahrazuje seedovaný rent roll. Vzory nájmu jsou DATA (p_params.rent_patterns); bez nich vrací prázdno s configured=false. Žádné roční číslo nevydává.';

revoke all on function public.get_rent_current(jsonb) from public, anon;
grant execute on function public.get_rent_current(jsonb) to authenticated, service_role;

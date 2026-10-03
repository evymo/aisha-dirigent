-- Data RPC pro blok 'table': ROZPAD PŘÍJMŮ ZA NÁJEMCE — nájem / energie / služby.
--
-- Rozpad se NEDÁ číst z hlavičky faktury: přefakturace energií chodí i na
-- SAMOSTATNÉ faktuře, takže jedna hlavička může být celá „energie" a jiná celá
-- „nájem". Pravda je v ŘÁDCÍCH dokladů (`li_source_registry.line_items`) a
-- agregace je přes VŠECHNY doklady jednoho nájemce, ne per faktura.
--
-- ⭐ KLASIFIKACE JE DATA, NE KÓD
-- Které texty řádků znamenají nájem/energie/služby, je vlastnost podniku, ne
-- platformy — a mění se s tím, jak se fakturuje. Vzory proto přicházejí
-- v `p_params.classes` jako pole `{key, label_key, pattern}`; RPC jen aplikuje
-- první shodu v pořadí. Bez konfigurace vrátí všechno jako nezařazené, a to je
-- POCTIVÉ mlčení: prázdný katalog není důvod něco si domyslet.
--
-- ⚠️ POŘADÍ VZORŮ ROZHODUJE a je součástí konfigurace: „spotřeba plynu" je
-- energie, i když na faktuře za nájem; „Poskytnutí sídla" je vlastní kategorie,
-- ne nájem. Naměřeno na korpusu 2026-07-31: bez kontextu faktury je text řádku
-- nejednoznačný — „za měsíc 6/2022" JE nájem, ale samo o sobě to neřekne.
-- Proto se nezařazené drží ZVLÁŠŤ (klíč '?') a nikam se netichu nepřičítají:
-- kbelík „ostatní" s viditelnou částkou je odpověď, tiché rozpuštění lež.
--
-- ⭐ KNIHA FAKTUR ZA MĚSÍC (majitel 2026-09-29, náčrt „Smlouvy a nájmy v2", bod 3):
-- rozpad se dřív sčítal přes VŠECHNY doklady celé historie. Teď umí období
-- (měsíc vystavení) a faktury BEZ položek neztratí: jejich částka z hlavičky jde
-- do sloupce „bez rozpisu" — třídu neznáme, ale částku ano (neznámé ≠ 0, a ne
-- ani „ostatní"). Naměřeno 2026-09-29 (vydané): s položkami 5 797, BEZ 10 822
-- (hlavně starší exporty; od 08/2026 mají položky všechny).
--
-- Sloupce: klient · `trida_<klíč>` pro každou třídu z `classes` (popisek z konfigurace) ·
-- ostatni (řádek bez shody, klíč '?') · bez_rozpisu · celkem · dokladu.
--
-- Konfigurace (p_params):
--   classes          : [{key,label_key,pattern}] — vzory (regex, case-insensitive)
--   owner_company    : jen doklady té firmy (osa pohledu „podle firmy")
--   document_subtype : jen doklady toho druhu (kniha = 'issued', vydané); bez = všechny
--   obdobi_vychozi   : 'aktualni_mesic' = bez volby klienta jen aktuální měsíc;
--                      bez = celá historie (dosavadní chování). Jiná hodnota = chyba.
--   limit            : kolik nájemců (default 50, strop 500)
-- Klientské parametry (deklarace v source_params.client_params, volba uživatele):
--   mesic     : date — měsíc vystavení (kterýkoli den měsíce); přebíjí obdobi_vychozi
--   jen_tridy : ["N","E",…] — jen nájemci s nenulovou částkou v některé z tříd
--
-- SECURITY INVOKER → RLS rozhoduje; bez nároku prázdno, ne chyba.
-- Kontrakt: (jsonb) -> jsonb {data:{columns[], rows[]}, provenance}.

-- ⭐ ČERSTVOST Z DAT (brána `cerstvost-z-dat`, 2026-09-27): `freshness_at` = nejnovější čas
-- univerza bloku, spočtený ze STEJNÝCH řádků jako hodnota. Pořadí zdrojů času: čas ze zdroje
-- (u Money `source_modified_at`, až bude úplný; u jízd/událostí `occurred_at`) › příchod verze
-- dokladu (`created_at`). NE `ingested_at`/`updated_at` — ty přepisuje KAŽDÝ import (naměřeno
-- 2026-09-27: 813 smluv = jediný čas), takže by lhaly jako faktury zamrzlé na exportu ze 6. 8.
-- Hranice `created_at`: backfill starých dokladů má čas dnešní — pravda o příchodu, ne o obsahu.
-- Prázdné univerzum → `trace_id` nese `:no_data` a čas je jen záloha `coalesce(…, now())`.
-- Stav linky (běží/neběží) sem NEPATŘÍ — je to jiný signál.
create or replace function public.get_rent_breakdown(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with cfg as (
    select
      nullif(p_params->>'owner_company','')                          as company,
      nullif(p_params->>'document_subtype','')                       as subtype,
      coalesce(p_params->'classes', '[]'::jsonb)                     as classes,
      least(coalesce(nullif(p_params->>'limit','')::int, 50), 500)   as lim,
      -- období: volba klienta (mesic) › výchozí z konfigurace › celá historie
      public.obdobi_od_param(p_params)                               as mesic_od,
      case when jsonb_typeof(p_params->'jen_tridy') = 'array'
           then array(select jsonb_array_elements_text(p_params->'jen_tridy')) end as jen_tridy
  ),
  -- Doklady období (jedna řádka = jedna faktura), s položkami i bez.
  doklady as (
    select
      r.id,
      r.created_at as vznik,
      coalesce(r.fields->'counterparty'->>'value', '—') as klient,
      -- ⛔ nájemce = IČO, ne jméno (viz get_receivables_overdue): bez IČO jménem
      case when (r.fields->'counterparty_id'->>'value') ~ '^[0-9]{6,8}$'
           then r.fields->'counterparty_id'->>'value' end as ico,
      r.fields->'owner_company'->>'value'               as firma,
      case when (r.fields->'total_amount'->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
           then (r.fields->'total_amount'->>'value')::numeric end as hlavicka,
      coalesce(r.line_items, '[]'::jsonb)               as polozky
    from public.li_source_registry r
    cross join cfg
    where r.doc_type = 'invoice'
      and r.superseded_by is null
      and (cfg.company is null or r.fields->'owner_company'->>'value' = cfg.company)
      and (cfg.subtype is null or r.fields->'document_subtype'->>'value' = cfg.subtype)
      and (cfg.mesic_od is null or (
            (r.fields->'issue_date'->>'value') ~ '^\d{4}-\d{2}-\d{2}$'
            and (r.fields->'issue_date'->>'value')::date >= cfg.mesic_od
            and (r.fields->'issue_date'->>'value')::date <  (cfg.mesic_od + interval '1 month')::date))
  ),
  radky as (
    select
      d.id, d.klient, d.ico, d.firma,
      -- ⛔ Řádek NENÍ plochý objekt. Ingest zapisuje každou hodnotu s provenancí
      -- (`{value, raw, gate, span}`) — `li->>'item_name'` vracelo NULL a částka
      -- spadla na 0 ve VŠECH řádcích (naměřeno v produkci 2026-07-31). Nula
      -- z nedosažitelných dat vypadá jako „nájemce nic neplatí".
      li->'fields'->'item_name'->>'value'               as nazev,
      case when (li->'fields'->'line_total'->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
           then (li->'fields'->'line_total'->>'value')::numeric else 0 end as castka
    from doklady d
    cross join lateral jsonb_array_elements(d.polozky) li
  ),
  -- První shoda v pořadí vyhrává; bez shody klíč '?' (viditelné „ostatní").
  -- Faktura BEZ položek = třída 'bez' s částkou z hlavičky (třídu neznáme).
  zatridene as (
    select radky.id, radky.klient, radky.ico, radky.firma, radky.castka,
      coalesce((
        select c->>'key'
        from cfg, jsonb_array_elements(cfg.classes) with ordinality t(c, ord)
        where radky.nazev ~* (c->>'pattern')
        order by t.ord
        limit 1), '?') as trida
    from radky
    union all
    select d.id, d.klient, d.ico, d.firma, coalesce(d.hlavicka, 0), 'bez'
    from doklady d
    where jsonb_array_length(d.polozky) = 0
  ),
  -- ⭐ SLOUPCE Z KONFIGURACE (majitel 2026-09-29: třídy U = úroky a penále, S = počáteční
  -- stav): každá třída z `classes` má svůj sloupec `trida_<klíč>` s popiskem z konfigurace
  -- (první výskyt klíče v pořadí). Dřív byly sloupce N/E/P natvrdo a nová třída by se
  -- sečetla jen do „celkem" — neviditelná.
  tridy as (
    select key, label_key, ord from (
      select distinct on (c->>'key') c->>'key' as key, c->>'label_key' as label_key, t.ord
        from cfg, jsonb_array_elements(cfg.classes) with ordinality t(c, ord)
       where nullif(c->>'key', '') is not null
       order by c->>'key', t.ord) x
  ),
  po_tridach as (
    select coalesce(ico, 'jmeno:' || klient) as klic, trida, round(sum(castka))::text as castka
      from zatridene
     where trida in (select key from tridy)
     group by 1, 2
  ),
  souhrn as (
    select
      coalesce(ico, 'jmeno:' || klient)                                   as klic,
      min(klient)                                                         as klient,
      max(ico)                                                            as ico,
      string_agg(distinct firma, ' · ' order by firma)                    as firma,
      round(sum(castka) filter (where trida = '?'))::text                 as ostatni,
      round(sum(castka) filter (where trida = 'bez'))::text               as bez_rozpisu,
      round(sum(castka))::text                                            as celkem,
      count(distinct id)::text                                            as dokladu,
      sum(castka)                                                         as _sort
    from zatridene
    group by coalesce(ico, 'jmeno:' || klient)
    -- jen nájemci s nenulovou částkou v některé z vybraných tříd (volba klienta)
    having (select jen_tridy from cfg) is null
        or coalesce(sum(abs(castka)) filter (where trida = any (((select jen_tridy from cfg))::text[])), 0) > 0.005
    order by sum(castka) desc
    limit (select lim from cfg)
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'columns',
        jsonb_build_array(jsonb_build_object('key','klient', 'label_key','app.cols.counterparty'))
        || coalesce((select jsonb_agg(jsonb_build_object('key', 'trida_' || key, 'label_key', coalesce(label_key, 'app.cols.other'), 'align', 'right') order by ord)
                       from tridy), '[]'::jsonb)
        || jsonb_build_array(
             jsonb_build_object('key','ostatni',     'label_key','app.cols.other',      'align','right'),
             jsonb_build_object('key','bez_rozpisu', 'label_key','app.cols.unitemized', 'align','right'),
             jsonb_build_object('key','celkem',      'label_key','app.cols.total',      'align','right'),
             jsonb_build_object('key','dokladu',     'label_key','app.cols.documents',  'align','right')),
      -- `id` je IČO nájemce (bez IČO jméno) — `get_debtor_invoices` bere IČO
      -- i jméno, týž druh jako u dlužníků. Jméno je AKTUÁLNÍ (counterparty_labels).
      'row_kind', 'counterparty',
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id',          coalesce(s.ico, s.klient),
                 'klient',      coalesce(l.label, s.klient),
                 'ostatni',     coalesce(s.ostatni,'0'),
                 'bez_rozpisu', coalesce(s.bez_rozpisu,'0'),
                 'celkem',      coalesce(s.celkem, '0'),
                 'dokladu',     s.dokladu)
               || coalesce((select jsonb_object_agg('trida_' || t.key, coalesce(p.castka, '0'))
                              from tridy t left join po_tridach p on p.klic = s.klic and p.trida = t.key), '{}'::jsonb)
               order by s._sort desc)
        from souhrn s
        left join public.counterparty_labels((select array_agg(ico) from souhrn)) l on l.ico = s.ico),
        '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'li-source-registry',
      'freshness_at', to_char(coalesce((select max(vznik) from doklady), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'rent-breakdown'
                      || case when (select max(vznik) from doklady) is null then ':no_data' else '' end,
      -- Kolik řádků stojí na IČO (zbytek je klíčovaný jménem = nižší jistota identity:
      -- jméno může nést víc subjektů, a stroj podle jména jen navrhuje).
      'coverage', jsonb_build_object(
        'n', (select count(*) from souhrn where ico is not null),
        'm', (select count(*) from souhrn),
        'label_key', 'app.prov.coverage.with_ico')
    ) || public.scope_applied(p_params, 'owner_company')
  );
$$;

comment on function public.get_rent_breakdown(jsonb) is
  'Rozpad příjmů za NÁJEMCE (ne za fakturu — přefakturace energií chodí zvlášť) z řádků dokladů. Klasifikace přichází v p_params.classes jako vzory = DATA; nezařazené se drží zvlášť pod klíčem ? a nikam se tiše nepřičítají.';

revoke all on function public.get_rent_breakdown(jsonb) from public, anon;
grant execute on function public.get_rent_breakdown(jsonb) to authenticated, service_role;

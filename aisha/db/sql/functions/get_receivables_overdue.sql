-- Data RPC pro blok 'table': POHLEDÁVKY PO SPLATNOSTI — kdo kolik dluží k datu.
--
-- Odpovídá na otázku, kterou tabulka dokladů zodpovědět neumí: registr je
-- per-doklad, kdežto dlužník je AGREGÁT přes doklady jednoho odběratele. Proto
-- to nesmí počítat klient (pravidlo „žádné klientské agregace nad li_*") a proto
-- to není jen další filtr nad get_document_register.
--
-- ⭐ CO JE „PO SPLATNOSTI" (a co to NENÍ)
-- Pravdu o platbě nese `amount_unpaid` (Money `UhradyZbyva`): 0 = uhrazeno,
-- > 0 = dluh včetně částečné úhrady. NIKOLI `settled` — to je Money
-- `PriznakVyrizeno` a u UHRAZENÉ faktury bývá False; kdyby na něm blok stál,
-- tvrdil by miliardové nedoplatky (naměřeno 2026-07-30: 22 762 z 22 916 faktur
-- „neuhrazeno", včetně dokladů z 2016). A `KUhrade` taky ne: u uhrazené faktury
-- se rovná celkové částce stejně jako u neuhrazené.
--
-- ⭐⭐ OPRAVNÝ DOKLAD ODEČÍTÁ (rozhodnutí majitele 2026-08-05)
-- Dobropis nese ZÁPORNÉ `amount_unpaid`. Dřív ho podmínka `dluh > 0` odřízla
-- NA ÚROVNI DOKLADU, takže dlužník platil plnou částku, i když mu ji oprava
-- snížila. Naměřeno na produkci: KILINC 315 471 → 292 072 (dvě opravy −23 399);
-- napříč tabulkou 77 → 72 dlužníků (pět jich oprava vynuluje úplně) a
-- 8 197 070 → 8 070 801.
--
-- Z toho plynou tři pravidla, která spolu drží:
--   1. Záporné doklady se ZAPOČÍTÁVAJÍ, nefiltrují se pryč.
--   2. Práh „> 0" patří až na AGREGÁT dlužníka — kdo má po odečtu nulu nebo
--      míň, není dlužník a v tabulce nemá co dělat.
--   3. `due_date < dnes` platí JEN pro kladné doklady. Oprava musí snížit dluh
--      hned, jinak by dluh chvíli „přebýval" jen proto, že dobropis je čerstvý.
--      Ze stejného důvodu se na opravy nevztahuje ani `min_days`.
--
-- Doklad bez `amount_unpaid` (starší korpus bez stavu úhrady) se NEPOČÍTÁ —
-- mlčet je správnější než tvrdit dluh z pole, které pravdu o platbě nenese.
--
-- Stav dokladu (po splatnosti / dobropis / storno / předepsáno) rozhoduje
-- invoice_state — jeden slovník s kartou protistrany (2026-09-26). Storno a
-- faktura vystavená dopředu nejsou dluh; přijatá faktura taky ne.
--
-- ⛔ DLUŽNÍK = IČO, NE JMÉNO (majitel 2026-09-29, podnět idata #114): řádek je klíčovaný
-- IČO (bez IČO jménem — fyzické osoby, doklady bez IČO; totéž pravidlo jako karta
-- v counterparty_docs). Dřív `group by klient` (jméno z faktury): naměřeno na riq
-- 14 IČO s víc jmény (přejmenovaná firma = VÍC řádků) a 6 jmen s víc IČO
-- („Slezské kamenolomy a.s." = 29243661 dnes Business Park Ďáblická + 08300283 →
-- jeden řádek 142 268 Kč místo 117 975 + 24 293). Zobrazené jméno je AKTUÁLNÍ
-- (counterparty_labels — týž výběr jako karta), ne text staré faktury.
-- `firma` = VŠECHNY naše věřitelské firmy dlužníka (dřív max() — 16 IČO dluží
-- víc našim firmám a řádek ukázal jen jednu).
--
-- Konfigurace (p_params, vše volitelné — blok je DATA):
--   owner_company : jen doklady té firmy (osa pohledu „podle firmy")
--   min_days      : jen dluhy starší než N dní po splatnosti (na opravy neplatí)
--   limit         : kolik dlužníků vrátit (default 50, strop 500)
--   classes       : [{key,label_key,pattern}] — vzory položek (týž katalog jako rozpad
--                   get_rent_breakdown; data instance)
--   tridy_vztahu  : klíče tříd, které ZAKLÁDAJÍ vztah (bez = všechny třídy z classes)
-- Klientský parametr (volba uživatele):
--   jen_tridy_vztahu : bool — jen dlužníci, se kterými má TÁŽ naše firma vztah
--                      doložený aspoň jednou vydanou položkou z tříd vztahu (např.
--                      „jen nájemní dlužníci": odběratelé kameniva kamenolomů vypadnou,
--                      naměřeno 2026-09-29 24 → 1). Kolik dlužníků filtr skryl, nese
--                      provenance.coverage (n z m) — nic se nezahazuje potichu.
--                      Rozhoduje VZTAH (firma × protistrana), ne položky konkrétní
--                      faktury: úroky, penále a staré faktury bez položek patří k nájmu,
--                      i když samy vzor nemají.
--
-- SECURITY INVOKER → RLS na li_source_registry rozhoduje; bez nároku prázdno,
-- ne chyba (týž fail-closed vzor jako ostatní li_* čtečky).
--
-- Kontrakt: (jsonb) -> jsonb {data:{columns[], rows[]}, provenance}.

-- ⭐ ČERSTVOST Z DAT (brána `cerstvost-z-dat`, 2026-09-27): `freshness_at` = nejnovější čas
-- univerza bloku, spočtený ze STEJNÝCH řádků jako hodnota. Pořadí zdrojů času: čas ze zdroje
-- (u Money `source_modified_at`, až bude úplný; u jízd/událostí `occurred_at`) › příchod verze
-- dokladu (`created_at`). NE `ingested_at`/`updated_at` — ty přepisuje KAŽDÝ import (naměřeno
-- 2026-09-27: 813 smluv = jediný čas), takže by lhaly jako faktury zamrzlé na exportu ze 6. 8.
-- Hranice `created_at`: backfill starých dokladů má čas dnešní — pravda o příchodu, ne o obsahu.
-- Prázdné univerzum → `trace_id` nese `:no_data` a čas je jen záloha `coalesce(…, now())`.
-- Stav linky (běží/neběží) sem NEPATŘÍ — je to jiný signál.
create or replace function public.get_receivables_overdue(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with cfg as (
    select
      nullif(p_params->>'owner_company', '')                        as company,
      greatest(coalesce(nullif(p_params->>'min_days', '')::int, 0), 0) as min_days,
      least(coalesce(nullif(p_params->>'limit', '')::int, 50), 500)    as lim,
      public.receivable_from_param(p_params)                        as od,
      public.storno_values_param(p_params)                          as storno,
      coalesce(p_params->'classes', '[]'::jsonb)                    as classes,
      case when jsonb_typeof(p_params->'tridy_vztahu') = 'array'
           then array(select jsonb_array_elements_text(p_params->'tridy_vztahu')) end as tridy_vztahu,
      coalesce((p_params->>'jen_tridy_vztahu')::boolean, false)     as jen_vztah
  ),
  -- Vztah (naše firma × protistrana) doložený aspoň jednou vydanou položkou z tříd vztahu.
  -- Počítá se jen, když o filtr uživatel požádal.
  vztahy as (
    select distinct
           r.fields->'owner_company'->>'value' as firma,
           coalesce(case when (r.fields->'counterparty_id'->>'value') ~ '^[0-9]{6,8}$'
                         then r.fields->'counterparty_id'->>'value' end,
                    'jmeno:' || coalesce(r.fields->'counterparty'->>'value', '—')) as klic
      from public.li_source_registry r
      cross join cfg
      cross join lateral jsonb_array_elements(coalesce(r.line_items, '[]'::jsonb)) li
     where cfg.jen_vztah
       and r.doc_type = 'invoice'
       and r.superseded_by is null
       and r.fields->'document_subtype'->>'value' = 'issued'
       and exists (select 1 from jsonb_array_elements(cfg.classes) t(c)
                    where (li->'fields'->'item_name'->>'value') ~* (c->>'pattern')
                      and (cfg.tridy_vztahu is null or c->>'key' = any (cfg.tridy_vztahu)))
  ),
  -- Rozbalení dokladů: hodnoty pole nesou tvar {value, status, confidence…},
  -- takže se čte `->'x'->>'value'`, ne `->>'x'`. Datum se validuje regexem —
  -- vytěžená hodnota nemusí být datum a ::date by shodilo celý blok.
  doklady as (
    select
      r.created_at as vznik,
      coalesce(r.fields->'counterparty'->>'value', '—')      as klient,
      -- IČO jen v platném tvaru (jako counterparty_resolve); jiné = bez IČO → jménem
      case when (r.fields->'counterparty_id'->>'value') ~ '^[0-9]{6,8}$'
           then r.fields->'counterparty_id'->>'value' end    as ico,
      r.fields->'owner_company'->>'value'                    as firma,
      (r.fields->'amount_unpaid'->>'value')::numeric         as castka,
      (r.fields->'due_date'->>'value')::date                 as splatnost,
      -- Stav z JEDNOHO slovníku (invoice_state) — týž jako karta protistrany:
      -- storno není dluh, předepsaná faktura (vznik v budoucnu) taky ne.
      public.invoice_state(r.fields, cfg.od, cfg.storno)                 as stav
    from public.li_source_registry r, cfg
    where r.doc_type = 'invoice'
      and r.superseded_by is null
      -- Pohledávka = VYDANÁ faktura; přijatá je náš závazek, ne jeho dluh.
      and r.fields->'document_subtype'->>'value' = 'issued'
      and r.fields ? 'amount_unpaid'
      and (r.fields->'amount_unpaid'->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
      and (r.fields->'due_date'->>'value') ~ '^\d{4}-\d{2}-\d{2}$'
      and (cfg.company is null or r.fields->'owner_company'->>'value' = cfg.company)
  ),
  -- Kladné jen po splatnosti; záporné (opravy) VŽDY — viz pravidlo 3 výše.
  zapocitane_vse as (
    select d.*, (current_date - d.splatnost) as dni
    from doklady d, cfg
    where (d.stav = 'overdue' and (current_date - d.splatnost) >= cfg.min_days)
       or d.stav = 'correction'
  ),
  zapocitane as (
    select z.* from zapocitane_vse z, cfg
     where not cfg.jen_vztah
        or exists (select 1 from vztahy v
                    where v.firma = z.firma and v.klic = coalesce(z.ico, 'jmeno:' || z.klient))
  ),
  -- kolik dlužníků by bylo BEZ filtru vztahu (pro provenance.coverage)
  dluznici_bez_filtru as (
    select count(*) as m from (
      select 1 from zapocitane_vse group by coalesce(ico, 'jmeno:' || klient) having sum(castka) > 0.005) x
  ),
  -- Dlužník = odběratel, ne doklad. `max(dni)` jen přes KLADNÉ doklady — „jak
  -- dlouho to visí" se ptá na nezaplacenou fakturu, ne na dobropis.
  dluznici as (
    select
      coalesce(ico, 'jmeno:' || klient)                           as klic,
      min(klient)                                                 as klient,
      max(ico)                                                    as ico,
      string_agg(distinct firma, ' · ' order by firma)            as firma,
      round(sum(castka))::text                                    as castka,
      (max(dni) filter (where castka > 0.005))::text              as dni,
      (count(*) filter (where castka > 0.005))::text              as dokladu,
      (count(*) filter (where castka < -0.005))::text             as oprav,
      sum(castka)                                                 as _sort
    from zapocitane
    group by coalesce(ico, 'jmeno:' || klient)
    -- Práh až na agregátu (pravidlo 2): koho oprava vynulovala, není dlužník.
    having sum(castka) > 0.005
    order by sum(castka) desc
    limit (select lim from cfg)
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'columns', jsonb_build_array(
        jsonb_build_object('key','klient',  'label_key','app.cols.counterparty'),
        jsonb_build_object('key','firma',   'label_key','app.cols.owner_company'),
        jsonb_build_object('key','castka',  'label_key','app.cols.overdue_amount','align','right'),
        jsonb_build_object('key','dni',     'label_key','app.cols.overdue_days',  'align','right'),
        jsonb_build_object('key','dokladu', 'label_key','app.cols.documents',     'align','right'),
        jsonb_build_object('key','oprav',   'label_key','app.cols.corrections',   'align','right')
      ),
      -- CO řádek JE. Bez tohohle pole má shell pro `id` jediný význam
      -- („dokument") a klik na dlužníka poslal IČO čtečce dokladů — ta na něj
      -- nic nenašla a vydala PRÁZDNOU kartu místo chyby (naměřeno 08-07).
      -- Druh vydává RPC, protože jedině ona ví, co do `id` dala.
      'row_kind', 'counterparty',
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
                 -- `id` je klíč pro proklik na seznam faktur dlužníka
                 -- (get_debtor_invoices bere counterparty_id, jinak jméno).
                 'id',      coalesce(d.ico, d.klient),
                 'klient',  coalesce(l.label, d.klient),
                 'firma',   coalesce(d.firma, '—'),
                 'castka',  d.castka,
                 'dni',     coalesce(d.dni, '0'),
                 'dokladu', d.dokladu,
                 'oprav',   d.oprav)
               order by d._sort desc)
        from dluznici d
        left join public.counterparty_labels((select array_agg(ico) from dluznici)) l on l.ico = d.ico),
        '[]'::jsonb)
    ),
    'provenance', jsonb_build_object(
      'source_slug',  'li-source-registry',
      'freshness_at', to_char(coalesce((select max(vznik) from doklady), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id',     'receivables-overdue'
                      || case when (select max(vznik) from doklady) is null then ':no_data' else '' end
    ) || case when (select jen_vztah from cfg) then jsonb_build_object('coverage', jsonb_build_object(
           'n', (select count(*) from (select 1 from zapocitane group by coalesce(ico, 'jmeno:' || klient) having sum(castka) > 0.005) y),
           'm', (select m from dluznici_bez_filtru),
           'label_key', 'app.prov.coverage.relation_debtors'))
         else '{}'::jsonb end
      || public.scope_applied(p_params, 'owner_company')
  );
$$;

comment on function public.get_receivables_overdue(jsonb) is
  'Pohledávky po splatnosti agregované na odběratele. Stojí na stavu úhrady z účetnictví (Money UhradyZbyva), NIKOLI na settled/PriznakVyrizeno. Opravné doklady (záporné amount_unpaid) ODEČÍTAJÍ a nepodléhají filtru splatnosti; práh „dluží“ se uplatní až na agregátu, takže koho oprava vynuluje, ten v tabulce není. Doklad bez amount_unpaid se nepočítá.';

revoke all on function public.get_receivables_overdue(jsonb) from public, anon;
grant execute on function public.get_receivables_overdue(jsonb) to authenticated, service_role;

-- ============================================================================
-- Source of Truth: counterparty_resolve
-- Popis: rozřeší PROTISTRANU na její identitu v modelu — jeden tvar pro oba
--        vstupy karty protistrany:
--          { debtor: IČO | jméno }   ← řádek přehledu dlužníků (row_kind counterparty)
--          { twin_id: uuid }         ← twin firmy (registr nájemců, identita)
--        Vrací IČO (icos), jména z dokladů (names) a twiny firmy (twins).
--
-- ⭐ TWIN JE ENTITA, IČO JE PARAMETR (majitel 2026-07-26). Karta proto nestojí
--    na řetězci IČO — ukazuje, KOLIK twinů danou identitu nese: naměřeno
--    2026-09-23 na <fork>-instanci, ze 102 dlužníků po splatnosti má 27 právě jeden twin,
--    42 VÍC twinů se stejným IČO (duplicita dvou identit ingestu téhož zdroje)
--    a 33 žádný. Roztříštěná identita je nález, který se má ukázat, ne schovat.
--
-- ⛔ JMÉNO NENÍ IDENTITA: totéž jméno nese víc IČO (různé firmy) a firma se
--    přejmenovává. Doklady se proto berou podle IČO; podle jména JEN ty, které
--    IČO nemají (fyzické osoby, doklady bez IČO) — viz counterparty_docs.
--    Návrhy `company_name` u twinů jsou zašuměné (u IČO ETRK s.r.o. stojí
--    „Moravská nemovitostní a.s." — jméno NAŠÍ firmy), proto se jména berou
--    z dokladů, ne z návrhů.
--
-- twins: [{id, label, certainty}] — certainty 'confirmed' = vazbu IČO potvrdil
--        člověk, 'proposed' = navrhl stroj (fronta identifikace), 'derived' =
--        twin BEZ IČO, jehož jméno v dokladech nese jen tahle firma (druhá
--        identita téže firmy — nález „ke sjednocení", ne sloučení; sjednocuje
--        člověk přes ingest_navrhy).
-- label: SCHVÁLENÝ název (company_name potvrzený člověkem, platný teď); dočasně bez
--        schválení jméno z nejnovějšího dokladu s IČO firmy; teprve pak název dvojčete.
-- SECURITY INVOKER: viditelnost rozhoduje RLS. ⛔ Proto se filtruje přes GENEROVANÉ
--    sloupce registru (counterparty_id_value, counterparty_value), ne přes výraz nad
--    `fields`: výraz nad jsonb není leakproof, pod RLS jde za politiku a index nepoužije
--    (naměřeno riq 2026-09-29: 2 706 ms jako admin, 23 ms jako service_role).
-- ROWS 1 = PRAVDA, ne ladění: závěrečný SELECT jsou jen skalární poddotazy BEZ FROM,
--    takže funkce vrací VŽDY právě jeden řádek. Výchozí ROWS 1000 lhal: volající
--    `id × counterparty_docs(...)` odhadl na 1 000 000 řádků (skutečně 0–stovky) →
--    karta 676 317, aging 810 514, web 305 974 → plný JIT (naměřeno riq 2026-09-30:
--    karta 1,8–2,8 s s JIT, 14–240 ms bez). S ROWS 1: 4 038 / 811 / 4 606, md5 36/36.
--    Kdo sem přidá FROM nebo SETOF, MUSÍ ROWS změnit — hlídá výjimka v bráně
--    predikat-naroku-vychozi-cost a runtime test odhad-karty-protistrany.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.counterparty_resolve(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (icos text[], names text[], twins jsonb, label text)
LANGUAGE sql
STABLE
SECURITY INVOKER
ROWS 1
SET search_path TO 'public', 'pg_temp'
AS $$
  with vstup as (
    select nullif(btrim(p_params->>'debtor'), '') as debtor,
           case when coalesce(p_params->>'twin_id', '')
                     ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then (p_params->>'twin_id')::uuid end as twin_id
  ),
  -- ⛔ DVOJČATA SE ČTOU JEN VE SDÍLENÝCH MNOŽINÁCH (2026-09-30, riq, člen 7f2a3dd3):
  -- každý výskyt twin_entities / twin_external_refs v dotazu nese vlastní výpočet
  -- rozsahu uživatele v RLS (twin_ids_v_rozsahu, ~120 ms, Postgres ho mezi výskyty
  -- nesdílí). Resolve jich měl 4 (EXPLAIN ANALYZE: 487 z 642 ms), karta člena 37×.
  -- Proto: v_ent/v_ref (vstup twin_id), ref_ico → ent → ref_ent (firma) — každá
  -- jednou, MATERIALIZED; větve níž berou z nich. Při vstupu {debtor} je twin_id
  -- NULL → index v_ent/v_ref nevrátí nic a politika se vůbec nevyhodnotí.
  v_ent as materialized (
    select t.id, t.label
      from public.twin_entities t
     where t.id = (select twin_id from vstup)
  ),
  v_ref as materialized (
    select r.source_key
      from public.twin_external_refs r
     where r.twin_id = (select twin_id from vstup)
       and r.ref_kind = 'company_ico' and r.state <> 'rejected'
  ),
  -- IČO: z twinu (vazby company_ico, kromě zamítnutých), nebo dlužník sám, je-li to IČO
  ico as (
    select distinct r.source_key as ico from v_ref r
    union
    select v.debtor from vstup v where v.debtor ~ '^[0-9]{6,8}$'
    union
    -- Twin BEZ vazby IČO (druhá identita ingestu, klíčovaná jménem): IČO z dokladů
    -- se jménem = label twinu — jen když to jméno nese JEDINÉ IČO. Zrcadlo
    -- jmena_jednoznacna níž: z twinu bez IČO musí karta i Ask dojít k týmž
    -- fakturám jako z twinu s IČO (naměřeno 2026-09-25: Ask trefil twin bez IČO
    -- a o dluhu nevěděl nic).
    select min(r.counterparty_id_value)
      from v_ent t
      join public.li_source_registry r
        on r.superseded_by is null and r.counterparty_value = t.label
     where r.counterparty_id_value is not null
       and not exists (select 1 from v_ref)
    having count(distinct r.counterparty_id_value) = 1
  ),
  -- jméno bez IČO: dlužník, který není IČO, nebo label twinu bez vazby IČO
  jmeno_vstup as (
    select v.debtor as jmeno from vstup v where v.debtor is not null and v.debtor !~ '^[0-9]{6,8}$'
    union
    select t.label from v_ent t
     where not exists (select 1 from ico)
  ),
  -- DOKLADY s IČO firmy — JEDNOU (MATERIALIZED): z téže množiny jména v čase
  -- (jmena) i jméno z nejnovějšího dokladu (aktualni). ⛔ Každý výskyt registru
  -- v dotazu nese vlastní vyhodnocení politiky RLS (u člena li_doc_slugs_claimed_by,
  -- riq 2026-09-29 ~5,4 s za výskyt; Postgres stejné poddotazy mezi výskyty
  -- neslučuje) — dva výskyty téže množiny = dvojí cena.
  doklady_ico as materialized (
    select r.counterparty_value as jmeno,
           coalesce(r.fields->'issue_date'->>'value', r.created_at::date::text) as datum,
           r.created_at
      from public.li_source_registry r
     where r.superseded_by is null
       and r.counterparty_id_value in (select ico from ico)
  ),
  -- jména z DOKLADŮ s daným IČO (jména v čase), plus jméno ze vstupu
  jmena as (
    select distinct d.jmeno from doklady_ico d where d.jmeno is not null
    union
    select jmeno from jmeno_vstup where jmeno is not null
  ),
  -- Jména, která v dokladech nese JEN tahle firma: žádný platný doklad s tím
  -- jménem nemá jiné IČO. Jméno sdílené víc firmami twin nepřipojí (⛔ jméno
  -- není identita) — jednoznačné jméno ale je důkaz, že twin bez IČO se týmž
  -- jménem je DRUHÁ identita téže firmy (dva ingesty téhož zdroje, naměřeno
  -- 2026-09-25 na Inspiraci: twin s IČO + twin bez IČO nesoucí jedinou smlouvu).
  jmena_jednoznacna as (
    select j.jmeno from jmena j
     where exists (select 1 from ico)
       and not exists (
         select 1 from public.li_source_registry r
          where r.superseded_by is null
            and r.counterparty_value = j.jmeno
            and r.counterparty_id_value is not null
            and r.counterparty_id_value not in (select ico from ico))
  ),
  -- Firma v dvojčatech — tři sdílené množiny místo čtení v každé větvi (viz v_ent):
  -- vazby IČO → dvojčata firmy (podle vazby nebo jména) → jejich vazby.
  ref_ico as materialized (
    select r.twin_id, r.state
      from public.twin_external_refs r
     where r.ref_kind = 'company_ico' and r.state <> 'rejected'
       and r.source_key in (select ico from ico)
  ),
  ent as materialized (
    select t.id, t.label
      from public.twin_entities t
     where t.entity_type = 'company' and t.status = 'active'
       and (t.id in (select twin_id from ref_ico)
            or t.label in (select jmeno from jmeno_vstup)
            or t.label in (select jmeno from jmena_jednoznacna))
  ),
  ref_ent as materialized (
    select r.twin_id, r.ref_kind, r.state, r.source_key, r.valid_from, r.valid_to, r.confirmed_at
      from public.twin_external_refs r
     -- pole, ne `in (select … union …)`: bez odhadu velikosti planner volil sekvenční
     -- průchod celé tabulky (riq 2026-09-30: +150 ms); `= any(pole)` jde po indexu twin_id
     where r.twin_id = any(array(select id from ent union select id from v_ent))
       and r.ref_kind in ('company_ico', 'company_name', 'nase_firma')
  ),
  -- twiny firmy: nesoucí některé z IČO, nebo (bez IČO) se shodným labelem, nebo zadaný
  tw as (
    select t.id, t.label,
           case when bool_or(r.state = 'confirmed') then 'confirmed' else 'proposed' end as certainty
      from ref_ico r
      join ent t on t.id = r.twin_id
     group by t.id, t.label
    union
    select t.id, t.label, 'derived'
      from ent t
     where not exists (select 1 from ico)
       and t.label in (select jmeno from jmeno_vstup)
    union
    -- twin BEZ vazby IČO se jménem, které nese jen tahle firma → odvozeno ze jména
    select t.id, t.label, 'derived'
      from ent t
     where t.label in (select jmeno from jmena_jednoznacna)
       and not exists (select 1 from ref_ent r
                        where r.twin_id = t.id and r.ref_kind = 'company_ico' and r.state <> 'rejected')
    union
    select t.id, t.label, 'confirmed'
      from v_ent t
  ),
  -- ⭐ JMÉNO FIRMY (majitel 2026-09-28): platí SCHVÁLENÝ název — company_name, který
  -- potvrdil člověk (platný teď). Změna jména na dokladu je NÁVRH ingestu, ne pravda,
  -- dokud ji člověk neschválí. Do té doby (dnes schválených jen 17 jmen, 2 193 návrhů
  -- čeká) je DOČASNOU zálohou jméno z nejnovějšího dokladu s IČO firmy, teprve pak
  -- název dvojčete — naměřeno: z 1 518 firem s IČO má 181 název jiný než poslední jméno
  -- z dokladů, 53 ADRESU („Petrská 1426/1" místo SFR Motor s.r.o.), 28 samotné IČO.
  aktualni as (
    select btrim(d.jmeno) as jmeno
      from doklady_ico d
     where length(btrim(coalesce(d.jmeno, ''))) between 2 and 80
     order by d.datum desc, d.created_at desc
     limit 1
  ),
  twu as (
    select id, min(label) as label,
           case when bool_or(certainty = 'confirmed') then 'confirmed'
                when bool_or(certainty = 'proposed') then 'proposed' else 'derived' end as certainty
      from tw group by id
  )
  , schvalene as (
    select r.source_key as jmeno
      from ref_ent r
     -- `nase_firma` = potvrzená naše firma (agenda zdroje) — její jméno je schválené
     where r.ref_kind in ('company_name', 'nase_firma') and r.state = 'confirmed'
       and r.twin_id in (select id from twu)
       and (r.valid_from is null or r.valid_from <= now())
       and (r.valid_to is null or r.valid_to > now())
     order by r.valid_from desc nulls last, r.confirmed_at desc nulls last
     limit 1
  )
  select
    coalesce((select array_agg(ico order by ico) from ico where ico is not null), '{}'::text[]),
    coalesce((select array_agg(jmeno order by jmeno) from jmena), '{}'::text[]),
    coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label, 'certainty', certainty) order by label, id) from twu), '[]'::jsonb),
    coalesce((select jmeno from schvalene),
             (select jmeno from aktualni),
             (select label from twu order by (certainty = 'confirmed') desc, label limit 1),
             (select jmeno from jmeno_vstup limit 1),
             (select min(jmeno) from jmena),
             (select debtor from vstup));
$$;

REVOKE ALL ON FUNCTION public.counterparty_resolve(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.counterparty_resolve(jsonb) TO authenticated, service_role;

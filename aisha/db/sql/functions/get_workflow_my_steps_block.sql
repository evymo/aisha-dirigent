-- ============================================================================
-- Source of Truth: get_workflow_my_steps_block
-- Popis: Surface blok review_queue: MOJE čekající milníky jako odklikávací
--        fronta. Sloupce řádku deklaruje KONFIGURACE bloku (source_params),
--        takže doménový slovník (dodací list, odběratel, adresa) je DATA
--        instance a v téhle funkci není ani jedno takové slovo.
--
-- ⚠️ PŘEPSÁNO 07-28 — předchozí verze byla proti kontraktu a v produkci se
-- TIŠE NEVYKRESLOVALA. Vracela `data:{items:[{id,title,quote,status,reward}]}`,
-- ale schéma review_queue vyžaduje ['entity_kind','items','actions'] a u položky
-- povoluje jen id/title/title_key/subtitle_key/state/fields/quote (obojí
-- additionalProperties:false). Ajv ve webovém shellu tedy blok odmítl,
-- loadConsole ho zahodil s console.warn a uživatel viděl prázdno — vypadalo to
-- jako „nejsou data", ne jako porušený kontrakt. Nativní klient ho kreslil,
-- protože nevaliduje; proto si toho nikdo nevšiml.
-- Opraveny zároveň dvě další vady:
--   • `limit` byl NO-OP: stál ZA jsonb_agg bez GROUP BY, tedy omezoval počet
--     řádků agregovaného výsledku (vždy 1), ne počet položek fronty.
--   • fronta neměla osu „na kdy" — nešlo se zeptat „co mám dnes".
--
-- VIDITELNOST: řádky filtruje SDÍLENÝ predikát workflow_step_visible_to
-- (přiřazení · role · potvrzená twin vazba). Žádná inline kopie — je to jediné
-- místo, které o twin identity vrstvě ví. ⚠️ Pozor při konfiguraci procesu:
-- predikát vyhodnocuje ROLI PŘED vazbou a při shodě rovnou vrací true, takže
-- uzel, který má assigned_role, uvidí KAŽDÝ držitel té role. Kdo chce „jen svoje
-- řádky", nesmí uzlu dát roli a musí mu dát authorized_twin_id.
--
-- Konfigurace (p_params; dispatcher merguje source_params || p_params):
--   status      volitelné  stav kroku, default 'pending'; 'any' = neptej se na stav
--   step_code   volitelné  jen tenhle uzel procesu (např. jediný lidský milník)
--   due         volitelné  'today' → jen běhy s production_date = dnes
--   date_from   volitelné  YYYY-MM-DD — ABSOLUTNÍ okno, PŘEBÍJÍ `due` (kalendář)
--   date_to     volitelné  YYYY-MM-DD; jen jedno z nich = ten jediný den
--   include_done_today volitelné  true → PŘIDÁ i kroky dokončené DNES
--               (state 'human_confirmed' — hodnota UŽ JE ve výčtu schématu,
--                kontrakt se nemění). Řidičova páska bez nich nemá sekci
--                „Hotovo" ani součet dnešní těžby; dokončené řadí NAKONEC,
--                fronta čekajících zůstává první.
--   limit       volitelné  default 20, strop 200
--   source_state volitelné {field, closed_when, stable_key?, label_key?,
--               value_key?} — ŽIVÝ stav ze zdroje přes ukazatel
--               `input_data->>'doc_slug'` do li_source_registry. Registr je
--               content-addressed a změněný doklad má nový slug, proto
--               `stable_key` = jméno pole s IDENTITOU dokladu ve zdroji (DATA
--               instance; v běhu i v registru pod stejným jménem) — ptá se ho
--               jen tam, kde ukazatel nic nenašel. Bez něj se ptá jen
--               ukazatel. Řádek, jehož
--               `fields-><field>->>'value'` = `closed_when`, se z fronty
--               VYNECHÁ. Bez `label_key` se položka neanotuje (klíč je ve
--               schématu povinný — objekt bez něj shodí validaci celého bloku).
--               Řádek BEZ ukazatele nebo bez řádku v registru ZŮSTÁVÁ.
--   include_source_closed volitelné true → zavřené zdrojem se NEVYNECHAJÍ
--               (back-office pohled; páska v kabině je nechce)
--   fields      volitelné  pole [{key, label_key, src}] = sloupce řádku
--               (POZOR: `label` tu NEEXISTUJE, na rozdíl od tabulkových bloků —
--                schéma review_queue vyžaduje u pole key + label_key)
--               src: 'batch_code' | 'product_name' | 'production_date'
--                    | 'step_name' | 'step_code' | 'description'
--                    | 'input:<cesta>' (hodnota z input_data uzlu; tečka = zanoření,
--                      takže deklarovaná odměna uzlu je 'input:reward.amount')
--   title_src   volitelné  co je nadpis řádku, tytéž hodnoty jako src;
--                          default 'step_name'
--   quote_src   volitelné  co je podtitulek řádku; default 'batch_code'
--   confirm_key volitelné  i18n klíč potvrzovacího tlačítka
--   deviation_key volitelné i18n klíč tlačítka „nesouhlasí"
--   confirm_capture   volitelné  co musí člověk dodat k potvrzení
--                     (['recipient','signature']) — bez toho je akce 1 klepnutí
--   deviation_capture volitelné  totéž pro odchylku (typicky ['note'])
--
--   ⚠️ capture se FILTRUJE proti uzavřenému výčtu ['recipient','signature','note']
--   a neznámá hodnota se zahodí; trace_id pak nese ':bad-capture'. Nestačí ošetřit
--   prázdné pole: schéma akce má u capture ENUM, takže by jediný překlep
--   v instančních datech neshodil jedno pole, ale validaci CELÉHO bloku — a fronta
--   by řidiči ve webovém shellu beze slova zmizela. Konfigurace je DATA a data se
--   validují na hranici; klient jí nesmí věřit víc než ona sama sobě.
--
-- Kontrakt review_queue nedovoluje v `provenance` klíč 'error', a `actions`
-- musí mít aspoň jednu položku — poctivá degradace se proto NESMÍ hlásit
-- provenance.error jako u tabulkových bloků. Nese ji `trace_id`: fronta bez
-- konfigurace vrátí platný prázdný tvar a důvod je v trace_id.
--
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
--
-- ⚡ PŘEPIS NÁROKU NA MNOŽINY (2026-07-30, změřeno na produkci):
--   33 325 ms → 36 ms (admin) · dispečerský all_assignees ~48 s → 286 ms.
--   Per-row workflow_step_visible_to (SECURITY DEFINER = žádný inline = 60 642
--   volání) + per-row auth.uid() (JWT parsing v join filtru, ~215 µs/řádek)
--   nahrazeny CTE `scope` (me/is_admin/my_roles/my_twins) — InitPlan, jednou.
--   Rovnocennost doložena 9/9 shodou CELÉHO výstupu (bez freshness_at) pro
--   3 identity × 3 varianty; množiny ramen md5: twin 9d49e9be…, role 40 428
--   kroků 7d0d49c1…. Oracle workflow_step_visible_to ZŮSTÁVÁ vlastníkem
--   pravidla pro jednotlivý krok (potvrzovací RPC) — tady je týž nárok množinově.
--
-- ⛔ DVĚ SLEPÉ ULIČKY, OBĚ ZMĚŘENÉ — ať to nikdo nezkouší potřetí:
--
--   1) „Vytáhnout predikát do funkce, aby ho Postgres inlinoval." NEJDE.
--      Inlinuje se jen tělo, které je JEDINÝ VÝRAZ BEZ `FROM` — a scope
--      (role, twin vazby) se bez `FROM` načíst nedá. Změřeno: pokus
--      o inlinovatelný predikát 97 028 ms, tedy HORŠÍ než per-row oracle
--      (63 734 ms), který nahrazoval.
--      Předat scope argumentem by inlining umožnilo, ale volající by ho mohl
--      PODVRHNOUT (`is_admin => true`) a padla by celá záruka nároku. Je to
--      tedy slepá ulička i bezpečnostně, ne jen výkonově.
--
--   2) „Rozhodnout jednou a vracet MNOŽINU id z pomocné funkce
--      (workflow_visible_step_ids), blok pak jen `join`." Strukturálně
--      hezčí — jeden rozhodovatel místo predikátu opsaného v každém bloku —
--      ale měřitelně dražší: 917 ms proti dnešním 36 ms, a autor téhle
--      varianty sám vyčíslil cenu na admin 592 → 1 181 ms, člen 60 → 181 ms.
--      Množina se totiž musí spočítat nad VŠEMI kroky, kdežto CTE `scope`
--      nechá plánovač zkombinovat nárok s ostatními predikáty (status,
--      step_code, časové okno) a sáhnout jen na to, co blok opravdu chce.
--      Kdo bude nárok potřebovat v dalším bloku, ať zkopíruje CTE `scope`
--      (je to InitPlan, čtyři hodnoty) a NE ať staví množinovou funkci.
--
--   Kdyby se rozhodovatel přesto někdy vytahoval do vlastní funkce: takový
--   pomocník je volaný jen zevnitř SECURITY DEFINER bloku, takže právo
--   uživatele nepotřebuje a NESMÍ dostat `GRANT EXECUTE ... TO authenticated`.
--   Grant by ho přes PostgREST vydal jako veřejné RPC — nová veřejná plocha
--   bez důvodu (odhalí to brána db-types-cover-exposed-rpcs: co je grantnuté
--   pro authenticated, to API vydává, a musí to být i v typech).
--
-- 📌 `all_assignees` (dispečerský pohled) SLOŽENO Z PRODUKČNÍHO DRIFTU:
--   živá funkce ho 07-30 měla, repo ne (žádná větev). Zachováno 1:1 včetně
--   `:all` markeru v trace_id — konfigurace viditelnost jen zužuje, rozšíření
--   je podmíněné is_admin_or_staff.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_workflow_my_steps_block(p_params jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- ⛔ `cfg` NESMÍ BÝT MATERIALIZOVANÉ (naměřeno 2026-09-29 na produkci).
  -- CTE použité víckrát Postgres materializuje a jeho sloupce jsou pro planner
  -- neprůhledné — neví tedy, že blok bez `source_state` laterály nad registrem
  -- nikdy nespustí (`One-Time Filter: cfg.src_state ? 'stable_key'`), a ocenil
  -- je naplno × odhad kroků: 9 140 466 jednotek u práce za 60–140 ms. Tak velký
  -- odhad zapnul JIT s optimalizací a každé volání kompilovalo ~4,8 s
  -- (mtr_queue, mtr_review, dv_handover(_all), wf_my_steps: 5,0–5,5 s).
  -- `not materialized` vloží výrazy nad `p_params` přímo do podmínek → odhad
  -- 108 360 (generický plán), volání 0,30–0,44 s, výstup všech pěti bloků md5
  -- shodný. `cfg` je čistá funkce `p_params` (nic volatilního), vícenásobné
  -- vyhodnocení tedy nemění výsledek. Zbytek odhadu je výchozí selektivita GIN
  -- `fields @> …` s dynamickým klíčem — tu statistiky nepopíšou.
  with cfg as not materialized (
    select coalesce(nullif(p_params->>'status', ''), 'pending')       as want_status,
           nullif(p_params->>'step_code', '')                          as want_step,
           nullif(p_params->>'due', '')                                as want_due,
           -- ⭐ ABSOLUTNÍ OKNO — „ukaž mi, co bylo 3. srpna".
           -- `due='today'` umí jen okolí DNEŠKA, takže na jiný den se zeptat
           -- nešlo; kalendář je přitom jen jiný filtr nad touž frontou, ne druhá
           -- obrazovka. Parametry chodí OD KLIENTA (get_block_data merguje
           -- source_params || p_params), proto se tvar OVĚŘUJE a nepřetypovává
           -- naslepo: překlep v datu by jinak neshodil filtr, ale celý blok.
           case when p_params->>'date_from' ~ '^\d{4}-\d{2}-\d{2}$'
                then (p_params->>'date_from')::date end                 as want_from,
           case when p_params->>'date_to' ~ '^\d{4}-\d{2}-\d{2}$'
                then (p_params->>'date_to')::date end                   as want_to,
           least(coalesce((p_params->>'limit')::int, 20), 200)         as lim,
           coalesce(p_params->'fields', '[]'::jsonb)                   as fields,
           coalesce(nullif(p_params->>'title_src', ''), 'step_name')   as title_src,
           coalesce(nullif(p_params->>'quote_src', ''), 'batch_code')  as quote_src,
           coalesce(nullif(p_params->>'confirm_key', ''),   'app.wf.action.confirm')   as confirm_key,
           coalesce(nullif(p_params->>'deviation_key', ''), 'app.wf.action.deviation') as deviation_key,
           coalesce(p_params->'confirm_capture',   '[]'::jsonb) as confirm_capture,
           coalesce(p_params->'deviation_capture', '[]'::jsonb) as deviation_capture,
           coalesce((p_params->>'include_done_today')::boolean, false) as done_today,
           -- Dispečerský pohled: admin/staff smí vidět VŠECHNY kroky, ne jen své.
           -- Gate je AND s is_admin_or_staff() přímo v predikátu níž — kdo tu roli
           -- nemá, dostane svou frontu, ne chybu a hlavně ne cizí řádky. Konfigurace
           -- nikdy nesmí být tím, co rozšiřuje viditelnost.
           coalesce((p_params->>'all_assignees')::boolean, false)        as want_all,
           -- Okno kolem dneška, ve dnech. `due='today'` samo znamenalo PŘESNĚ
           -- dnešek, což je pro řidiče příliš úzké: zadání zní „rozvozy na dnešní
           -- a další den", a nepotvrzená včerejší dodávka je pořád jeho práce.
           -- Naměřeno 2026-07-31: s holým `today` vracela páska 0 položek,
           -- protože nejnovější doklady byly z předchozího dne.
           -- Výchozí 0/0 = původní chování.
           greatest(coalesce((p_params->>'due_back')::int, 0), 0)      as due_back,
           greatest(coalesce((p_params->>'due_ahead')::int, 0), 0)     as due_ahead,
           -- Filtr na PŘEDMĚT běhu. Čím se „ještě čeká na člověka" pozná, je
           -- vlastnost DOMÉNY, ne enginu: u dodáku `settled='False'`, jinde jiné
           -- pole. Proto DATA (jsonb containment), ne podmínka v kódu.
           -- Bez toho nabízel dispečink všech 20 592 předání místo 522 otevřených
           -- a první stránka byly doklady z roku 2020 bez řidiče.
           coalesce(p_params->'input_match', '{}'::jsonb)               as want_input,
           -- PROTĚJŠEK `input_match`, a není to symetrie pro symetrii.
           -- `input_match` je OBSAŽENÍ (`@>`), takže řádek, který ten klíč
           -- NEMÁ, nevyhoví nikdy. Dispečink tím ztrácel práci, o které
           -- zdroj nic netvrdí: naměřeno 2026-09-01 na produkci — 400
           -- otevřených předání, z toho 196 se `settled='False'` a 204 BEZ
           -- toho klíče (145 běhů klíčovaných ještě číslem dokladu, roky
           -- 2020–2026, a 59 dokladů, které příznak vyřízenosti nemají vůbec).
           -- Fronta jich tedy ukazovala 196 a o zbylých 204 mlčela.
           -- „Ne-vyřízené" nelze vyjádřit rovností: chybějící údaj NENÍ
           -- tvrzení o opaku. Vyloučení ANO — `settled='True'` je jediné,
           -- co zdroj skutečně řekl.
           coalesce(p_params->'input_exclude', '{}'::jsonb)             as skip_input,
           -- ⭐ ŽIVÝ STAV ZE ZDROJE. `input_match`/`input_exclude` se ptají KOPIE
           -- v `input_data`, která zamrzla při zakládání běhu; tohle se ptá
           -- UKAZATELE (`doc_slug`, viz ingest/workflow_runs.json) na řádek
           -- registru, tedy toho, co zdroj říká DNES.
           --
           -- ⛔ PROČ TO NEJDE ŘEŠIT OBNOVOU KOPIE: `ensure_workflow_run_for_subject`
           -- slévá předmět jako `p_subject || input_data`, tedy existující hodnota
           -- vyhrává — obnova umí klíč DOPLNIT, ne ZMĚNIT. Doklad, který se
           -- v účetnictví vyřídil, tedy v kopii zůstane „nevyřízený" napořád.
           -- Naměřeno 2026-08-31: ze 40 863 „pending" předání mělo 20 070 doklad
           -- `settled=True`. Proto UKAZATEL, ne kopie.
           --
           -- Doména je DATA: které pole registru a která hodnota znamenají
           -- „uzavřeno" (dodák `settled`/`True`, jinde jiné pole), plus i18n klíč
           -- popisku pro anotaci položky.
           coalesce(p_params->'source_state', '{}'::jsonb)               as src_state,
           -- Dispečink smí zavřené VIDĚT (back-office), řidičova páska ne —
           -- týž vzorec jako `p_include_closed` v get_my_workflow_steps.
           coalesce((p_params->>'include_source_closed')::boolean, false) as show_closed
  ),
  -- NÁROK JAKO MNOŽINY, spočítané JEDNOU za dotaz (InitPlan) — do 2026-07-30 se
  -- totéž ptalo PER ŘÁDEK přes workflow_step_visible_to (SECURITY DEFINER =
  -- žádný inline = 60 642 plných volání) a k tomu per-row auth.uid() (parsování
  -- JWT claims v join filtru, ~215 µs/řádek). Změřeno: 33-48 s → 42 ms (admin),
  -- 161 ms (operátor s rolí, 200 položek). Ramena jsou 1:1 s tou funkcí; ona
  -- zůstává vlastníkem pravidla pro JEDNOTLIVÝ krok (potvrzovací RPC) a jediným
  -- místem, které o twin identity vrstvě ví — tady je týž nárok, jen množinově.
  -- SECURITY DEFINER kontext čtení user_roles/twin_external_refs se NEMĚNÍ.
  -- Rovnocennost doložena md5 shodou množin: twin rameno 9d49e9be…, role rameno
  -- 40 428 kroků 7d0d49c1…, a shodou celého výstupu (bez freshness_at).
  scope as (
    select (select auth.uid()) as me,
           (select public.is_admin_or_staff()) as is_admin,
           coalesce((select array_agg(ur.role::text)
                     from public.user_roles ur
                     where ur.user_id = (select auth.uid())), '{}'::text[]) as my_roles,
           coalesce((select array_agg(r.twin_id::text)
                     from public.twin_external_refs r
                     where r.ref_kind = 'account'
                       and r.source_key = (select auth.uid())::text
                       and r.state = 'confirmed' and r.valid_from <= now()
                       and (r.valid_to is null or r.valid_to > now())), '{}'::text[]) as my_twins
  ),
  -- Jedno místo, které ví, co je platná položka capture. Kdyby bylo dvakrát
  -- (jednou pro potvrzení, jednou pro odchylku), rozejde se to při přidání typu.
  -- `jsonb_agg ... filter` vrátí na prázdném vstupu NULL, takže se klíč vynechá
  -- a akce zůstane jedním klepnutím — což je zároveň jediný správný tvar,
  -- protože schéma u capture vyžaduje minItems 1.
  capture as (
    select 'confirm' as slot,
           jsonb_agg(v order by o) filter (where v in ('recipient','signature','note')) as ok,
           count(*) filter (where v not in ('recipient','signature','note')) as bad
      from (select value #>> '{}' as v, ordinality as o
              from jsonb_array_elements((select confirm_capture from cfg)) with ordinality) c
    union all
    select 'deviation',
           jsonb_agg(v order by o) filter (where v in ('recipient','signature','note')),
           count(*) filter (where v not in ('recipient','signature','note'))
      from (select value #>> '{}' as v, ordinality as o
              from jsonb_array_elements((select deviation_capture from cfg)) with ordinality) d
  ),
  mine as (
    select s.id, s.step_code, s.step_name, s.step_order, s.description,
           s.input_data, b.batch_code, b.product_name, b.production_date,
           -- Tvrzení zdroje o předmětu. Nese se dál JEN když zdroj řekl
           -- „uzavřeno" — u otevřené práce je to šum, ne informace.
           case when cfg.src_state <> '{}'::jsonb
                 and lower(coalesce(src.fields -> (cfg.src_state->>'field') ->> 'value', ''))
                     = lower(cfg.src_state->>'closed_when')
                then src.ingested_at end                              as src_closed_at,
           -- ⛔ CO ŘIDIČ NAPSAL, KANCELÁŘ NEVIDĚLA. `notes` je vyjádření
           -- pořizovatele k dodávce — reklamace, výhrada, poznámka z místa —
           -- a do 2026-09-01 se odsud nevybíralo, takže se nedalo deklarovat
           -- ani jako sloupec fronty. Blok tím pádem uměl říct, ŽE je předáno,
           -- ale ne S ČÍM. `completed_at` je druhá půlka téže odpovědi: kdy.
           s.notes, s.completed_at,
           s.status as raw_status,
           -- „Hotovo" pro ŘAZENÍ znamená „už se na to nečeká" — tedy i odchylka.
           -- Do 08-05 tu stálo jen `= 'completed'`, což nikomu nevadilo, protože
           -- se failed kroky do fronty nikdy nedostaly (status default 'pending'
           -- + include_done_today jen completed). S absolutním oknem se dostanou.
           (s.status in ('completed','failed')) as is_done,
           -- Čekající první (to jsou akce), dokončené nakonec v pořadí potvrzení —
           -- jediné číslování, aby limit platil přes obě skupiny předvídatelně.
           row_number() over (order by (s.status = 'completed'),
                                       case when s.status = 'completed'
                                            then s.completed_at end asc,
                                       b.production_date asc nulls last,
                                       b.created_at desc, s.step_order) as rn
    from public.production_workflow_steps s
    join public.production_batches b on b.id = s.batch_id
    cross join cfg cross join scope
    -- UKAZATEL → AKTUÁLNÍ VERZE ŘÁDKU REGISTRU.
    --
    -- ⚠️ Registr je content-addressed (`source_sha256` UNIQUE), takže znovu
    -- naingestovaný ZMĚNĚNÝ doklad dostane NOVÝ `doc_slug` a starý řádek jen
    -- `superseded_by` (nebo ho `li_dedupe_source_registry` odstraní úplně).
    -- Ukazatel v `input_data` proto míří na verzi, která už nemusí být platná —
    -- join na samotný `doc_slug` + `superseded_by is null` by u změněného
    -- dokladu nenašel NIC a řádek by ve frontě zůstal viset.
    --
    -- ⭐ DVA KROKY, NE JEDEN `OR`:
    --   1. `src_ptr` — přesný zásah ukazatelem (btree na `doc_slug`). U dokladu,
    --      který se od založení běhu nezměnil, je to celá práce.
    --   2. `src_id` — JEN když ukazatel nic nenašel: nejnovější platná verze se
    --      stejnou IDENTITOU VE ZDROJI. Které pole ji nese, je DATA instance
    --      (`source_state.stable_key`) — stejné pravidlo jako identity map
    --      u `li_dedupe_source_registry`: jméno pole natvrdo v SQL by bylo
    --      instanční slovo v kódu platformy. Hledá se obsažením (`@>`), takže
    --      jeden obecný GIN index nad `fields` slouží libovolnému klíči
    --      (`idx_li_source_registry_fields_gin`).
    --   Změřeno 2026-09-26 (PG 18, 43 000 řádků registru, 40 000 kroků, půlka
    --   s neplatným ukazatelem) proti předchozí variantě s klíčem natvrdo
    --   a btree výrazovým indexem: stránka řidiče 2,4 → 3,5 ms, dispečink
    --   273 → 201 ms (ukazatel napřed = identita jen u změněných dokladů),
    --   výsledek krok po kroku totožný (0 rozdílů ze 40 000).
    --
    -- Bez `src_state` se laterály nespustí (prázdná konfigurace = žádné čtení
    -- registru), takže bloky, které tuhle vlastnost nepoužívají, nestojí nic.
    -- Bez `stable_key` se ptá jen ukazatel — chybějící identita je poctivé
    -- „nevím“, ne domněnka; řádek pak podle pravidla níž ve frontě zůstane.
    left join lateral (
      select reg.fields, reg.ingested_at
        from public.li_source_registry reg
       where cfg.src_state <> '{}'::jsonb
         and reg.superseded_by is null
         and reg.doc_slug = s.input_data->>'doc_slug'
       order by reg.ingested_at desc
       limit 1
    ) src_ptr on true
    left join lateral (
      select reg.fields, reg.ingested_at
        from public.li_source_registry reg
       where src_ptr.fields is null
         and cfg.src_state ? 'stable_key'
         and nullif(s.input_data->>(cfg.src_state->>'stable_key'), '') is not null
         and reg.superseded_by is null
         and reg.fields @> jsonb_build_object(
               cfg.src_state->>'stable_key',
               jsonb_build_object('value', s.input_data->>(cfg.src_state->>'stable_key')))
       order by reg.ingested_at desc
       limit 1
    ) src_id on true
    cross join lateral (
      select coalesce(src_ptr.fields, src_id.fields)           as fields,
             coalesce(src_ptr.ingested_at, src_id.ingested_at) as ingested_at
    ) src
    where scope.me is not null
      -- ⛔ CHYBĚJÍCÍ ÚDAJ NENÍ TVRZENÍ O OPAKU — totéž pravidlo jako u
      -- `input_exclude` výš. Běh bez ukazatele (starší generace, klíčovaná
      -- číslem dokladu) i doklad, který v registru řádek nemá, ZŮSTÁVAJÍ ve
      -- frontě. Vyloučí se jen to, o čem zdroj skutečně řekl „uzavřeno".
      -- Fail-open je tu správně: tiše ztracená práce je horší než práce navíc.
      and (cfg.src_state = '{}'::jsonb
           or cfg.show_closed
           or src.fields is null
           or lower(coalesce(src.fields -> (cfg.src_state->>'field') ->> 'value', ''))
              is distinct from lower(cfg.src_state->>'closed_when'))
      and ((cfg.want_all and scope.is_admin)
           or s.assigned_user_id = scope.me
           or (s.assigned_role is not null and s.assigned_role = any(scope.my_roles))
           or ((s.input_data->>'authorized_twin_id') = any(scope.my_twins)))
      -- `status='any'` = neptej se na stav. Bez toho by kalendář na jakýkoli
      -- MINULÝ den vrátil prázdno, protože výchozí filtr je 'pending' a co bylo,
      -- to je hotové — tedy přesně ten tichý prázdný výsledek, který vypadá jako
      -- „nic tam nebylo" místo „ptáš se na špatný stav".
      and (cfg.want_status = 'any'
           or s.status = cfg.want_status
           -- Dnešní hotovo: dokončení DNES je vlastnost KROKU (completed_at),
           -- ne běhu — běh s včerejším production_date potvrzený dnes sem patří.
           or (cfg.done_today and s.status = 'completed'
               and s.completed_at::date = current_date))
      and (cfg.want_step is null or s.step_code = cfg.want_step)
      -- Předmět běhu musí odpovídat požadavku bloku. `@>` je containment,
      -- takže se porovnávají JEN uvedené klíče a je to indexovatelné.
      and (cfg.want_input = '{}'::jsonb
           or coalesce(s.input_data, '{}'::jsonb) @> cfg.want_input)
      and (cfg.skip_input = '{}'::jsonb
           or not (coalesce(s.input_data, '{}'::jsonb) @> cfg.skip_input))
      -- ⭐ ABSOLUTNÍ OKNO PŘEBÍJÍ RELATIVNÍ, nekombinuje se s ním.
      -- Kdyby se ANDovalo, blok s `due='today'` v konfiguraci by na jakýkoli jiný
      -- den vrátil PRÁZDNO — a prázdná fronta se nedá odlišit od „ten den se nic
      -- nevezlo". Klient, který se ptá na konkrétní den, říká něco UŽŠÍHO než
      -- výchozí nastavení bloku, takže rozhoduje on.
      and (case
             when cfg.want_from is not null or cfg.want_to is not null
               then b.production_date between coalesce(cfg.want_from, cfg.want_to)
                                          and coalesce(cfg.want_to, cfg.want_from)
             when cfg.want_due is null then true
             when cfg.want_due = 'today'
               then b.production_date between current_date - cfg.due_back
                                          and current_date + cfg.due_ahead
                    -- 'today' nesmí dnešnímu hotovu ukrást včerejší dohnané běhy:
                    or (cfg.done_today and s.status = 'completed'
                        and s.completed_at::date = current_date)
             else (cfg.done_today and s.status = 'completed'
                   and s.completed_at::date = current_date)
           end)
  ),
  -- Jedno místo, které umí přeložit `src` na hodnotu. Kdyby bylo dvakrát,
  -- rozejde se nadpis se sloupcem.
  resolved as (
    select m.*, (
      select jsonb_object_agg(k, v) from (
        select 'batch_code' as k, to_jsonb(m.batch_code) as v
        union all select 'product_name',    to_jsonb(m.product_name)
        union all select 'production_date', to_jsonb(to_char(m.production_date, 'DD.MM.YYYY'))
        union all select 'step_name',       to_jsonb(m.step_name)
        union all select 'step_code',       to_jsonb(m.step_code)
        union all select 'description',     to_jsonb(m.description)
        -- Vyjádření k dodávce a čas potvrzení. Že se ZOBRAZÍ, rozhoduje
        -- konfigurace instance (`fields`), ne tenhle výčet — platforma jen
        -- otevírá dveře. Prázdné pole se nekreslí (JAZYK-03), takže krok bez
        -- vyjádření nevyrobí prázdný řádek.
        union all select 'notes',           to_jsonb(m.notes)
        union all select 'completed_at',    to_jsonb(
                    to_char(m.completed_at, 'DD.MM.YYYY HH24:MI'))
      ) t
    ) as base
    from mine m
  ),
  rows_out as (
    select r.rn, jsonb_strip_nulls(jsonb_build_object(
      'id',    r.id::text,
      -- TVRZENÍ ZDROJE U POLOŽKY. Vydá se jen u vět, kde zdroj řekl „uzavřeno",
      -- a jen když konfigurace dodala popisek: `label_key` je ve schématu
      -- POVINNÝ, takže objekt bez něj by neshodil jedno pole, ale validaci
      -- CELÉHO bloku — a fronta by ve shellu beze slova zmizela. Chybějící
      -- popisek tedy znamená „neanotuj", ne „anotuj prázdně".
      -- (Táž třída jako `capture` níž; proto stejná opatrnost.)
      'source_state', case
        when r.src_closed_at is not null
         and (select src_state ? 'label_key' from cfg)
        then jsonb_strip_nulls(jsonb_build_object(
               'label_key',   (select src_state->>'label_key' from cfg),
               'value_key',   (select src_state->>'value_key' from cfg),
               'as_of',       to_char(r.src_closed_at at time zone 'UTC',
                                      'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'source_slug', 'li-source-registry')) end,
      'title', coalesce(
                 case when (select title_src from cfg) like 'input:%'
                      then r.input_data #>> string_to_array(
                             substring((select title_src from cfg) from '^input:(.*)$'), '.')
                      else r.base->>(select title_src from cfg) end,
                 r.step_name),
      'quote', case when (select quote_src from cfg) like 'input:%'
                    then r.input_data #>> string_to_array(
                           substring((select quote_src from cfg) from '^input:(.*)$'), '.')
                    else r.base->>(select quote_src from cfg) end,
      -- 'needs_review' = „čeká na tebe"; dokončené = 'human_confirmed';
      -- ODCHYLKA je 'failed' a NESMÍ se tvářit jako čekající práce — na den
      -- v minulosti by se jinak nabízela k odbavení věc, která už dopadla špatně.
      -- Všechny tři hodnoty jsou ve výčtu `fieldState` schématu review_queue.
      'state', case r.raw_status
                 when 'completed' then 'human_confirmed'
                 when 'failed'    then 'failed'
                 else 'needs_review' end,
      -- Sloupec smí nést VÝHRADNĚ key + label_key (+ hodnotu). Schéma review_queue
      -- má u pole `additionalProperties:false` a `required:['key','label_key']` —
      -- na rozdíl od tabulkových bloků, kde je volný `label`. Kdyby sem `label`
      -- prosákl z konfigurace, Ajv shodí CELÝ blok a ten ve webovém shellu tiše
      -- zmizí. Proto se klíč nebere z konfigurace jako pole, ale skládá se.
      'fields', (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'key',       f->>'key',
                 'label_key', coalesce(f->>'label_key', f->>'key'),
                 'value',     case when f->>'src' like 'input:%'
                                   then r.input_data #>> string_to_array(
                                          substring(f->>'src' from '^input:(.*)$'), '.')
                                   else r.base->>(f->>'src') end)))
        from jsonb_array_elements((select fields from cfg)) f
        where f ? 'key'
      ))) as item
    from resolved r
    where r.rn <= (select lim from cfg)
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      -- Osa zápisu: tlačítko fronty posílá entity_kind zpět do zapisovatele,
      -- který podle něj pozná, že jde o milník procesu.
      'entity_kind', 'workflow_step',
      'items', coalesce((select jsonb_agg(item order by rn) from rows_out), '[]'::jsonb),
      -- `capture` = co u téhle akce nedodá žádný stroj. jsonb_strip_nulls ho
      -- vynechá, když konfigurace mlčí — akce bez záchytu zůstává jedním
      -- klepnutím, což je designové pravidlo, ne detail.
      'actions', jsonb_build_array(
        jsonb_strip_nulls(jsonb_build_object(
          'action_key', (select confirm_key from cfg),
          'decision', 'HUMAN_CONFIRMED', 'intent', 'approve',
          'capture', (select ok from capture where slot = 'confirm'))),
        jsonb_strip_nulls(jsonb_build_object(
          'action_key', (select deviation_key from cfg),
          'decision', 'REJECTED', 'intent', 'reject',
          'capture', (select ok from capture where slot = 'deviation'))))),
    'provenance', jsonb_build_object(
      'source_slug', 'production_workflow',
      'freshness_at', now(),
      'trace_id', 'wf:my-steps'
                  || coalesce(':' || (select want_step from cfg), '')
                  || coalesce(':' || (select want_due from cfg), '')
                  -- Vybraný den musí být poznat z provenance ze stejného důvodu
                  -- jako dispečerský rozsah: táž konfigurace vrátí jinou množinu
                  -- podle toho, na co se klient zeptal, a čtenář má vidět NA CO.
                  || coalesce(':on:' || (select want_from from cfg)::text, '')
                  || coalesce('..' || (select want_to from cfg)::text, '')
                  || case when (select want_status from cfg) = 'any' then ':any-status' else '' end
                  || case when (select done_today from cfg) then ':done-today' else '' end
                  -- Dispečerský pohled musí být poznat z provenance: stejný blok
                  -- se stejnou konfigurací vrátí jinou množinu adminovi a jinou
                  -- řidiči, a čtenář má vidět KTEROU dostal.
                  || case when (select want_all from cfg)
                            and public.is_admin_or_staff(auth.uid()) then ':all' else '' end
                  || case when jsonb_array_length((select fields from cfg)) = 0
                          then ':no-fields-configured' else '' end
                  || case when (select sum(bad) from capture) > 0
                          then ':bad-capture' else '' end
                  -- Zúžení zdrojem musí být poznat z provenance: táž
                  -- konfigurace vrátí jinou množinu podle toho, co o dokladech
                  -- říká registr, a čtenář má vidět, že se filtrovalo ŽIVÝM
                  -- stavem, ne jen tím, co má běh v sobě.
                  || case when (select src_state <> '{}'::jsonb from cfg)
                          then ':src-state' else '' end
                  || case when (select show_closed from cfg)
                          then ':incl-closed' else '' end));
$function$;

REVOKE ALL ON FUNCTION public.get_workflow_my_steps_block(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workflow_my_steps_block(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workflow_my_steps_block(jsonb) TO service_role;

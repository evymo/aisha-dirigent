-- ============================================================================
-- Source of Truth: workflow_step_visible_to
-- Popis: Sdílený predikát viditelnosti milníku procesu. Tři cesty:
--          1. přímé přiřazení (assigned_user_id)
--          2. role (has_role)
--          3. potvrzená twin vazba — VOLITELNÁ, viz níže
--        Tohle je JEDINÉ místo, které o twin identity vrstvě ví; všechny
--        ostatní workflow funkce volají tento predikát (žádné inline kopie).
--          4. dispečerský rozsah (p_scope='dispatch') — VŠECHNY kroky, ale jen
--             pro admin/staff.
--          5. ÚČET ZAŘÍZENÍ (tablet, F2 2026-09-29) — kroky, které pokrývá aktivní
--             řádek `kiosk_rozsah` (DATA instance: step_code + input_match), a jen
--             s PLATNÝM průkazem (schválený, neodvolaný, nevypršelý — kontrola při
--             každém volání). Kód kroku musí předat volající z ŘÁDKU (`p_step_code`);
--             bez něj cesta neplatí (fail-closed: kdo ho nepředá, tabletu nic neukáže).
--             Od 2026-09-30 řádek s `jen_flotila` pustí JEN krok NAŠÍ flotily: potvrzené
--             párování řidiče nebo vozidla s Webdispečinkem (`kiosk_krok_nasi_flotily`).
--
-- PROČ JE ROZŠÍŘENÍ TADY A NE VE VOLAJÍCÍM (2026-07-30):
--   Dispečink potřebuje vidět cizí kroky. První verze to řešila ve volajícím:
--     and (case when cfg.want_all and is_admin_or_staff() then true
--               else workflow_step_visible_to(...) end)
--   To je bezpečnostní pojistka jako ŘÁDEK — kdo ji smaže, promění příznak
--   v `source_params` (a bloky zakládá instanční SQL) v tichou eskalaci práv.
--   Pojistka, která má důvod, nesmí být odstranitelná omylem.
--   Rozsah proto rozhoduje TENHLE predikát: volající ho volá BEZPODMÍNEČNĚ a
--   nemá jak ho obejít — jen mu předá, co chce vidět. Zrušit kontrolu znamená
--   sáhnout do sdílené bezpečnostní funkce, na které stojí všechny workflow
--   povrchy; takový zásah je hlučný a rozbije zbytek, ne jen dispečink.
--   Doplňkově to drží brána: volající nesmí obsahovat vlastní logiku viditelnosti.
--
-- VOLITELNÁ ZÁVISLOST (proč dynamic SQL):
--   Twin identity vrstva (`twin_external_refs`) je nepovinný subsystém — jádro
--   ji nemusí mít nainstalovanou. Statická reference by se validovala už při
--   CREATE FUNCTION (u LANGUAGE sql), takže baseline by na ČISTÉ DB neprošel a
--   cold-start každé nové instance by spadl. Proto: plpgsql (tělo se při CREATE
--   neparsuje) + to_regclass guard + EXECUTE. Když vrstva chybí, tahle cesta se
--   prostě neuplatní; když je nainstalovaná, chová se přesně jako dřív.
--
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern
-- ============================================================================

CREATE OR REPLACE FUNCTION public.workflow_step_visible_to(
  p_uid uuid,
  p_assigned_user uuid,
  p_assigned_role text,
  p_input jsonb,
  -- Co chce volající vidět. NULL/cokoli jiného = jen svoje (výchozí je vždy užší
  -- pohled). 'dispatch' = všechny kroky — a platí JEN pro admin/staff; komu role
  -- chybí, dostane svou frontu, ne chybu: fail-closed tu znamená degradovat, ne
  -- spadnout, jinak by blok ze sekce zmizel a nikdo by nevěděl proč.
  p_scope text DEFAULT NULL,
  -- Kód kroku (production_workflow_steps.step_code) — jen pro pátou cestu (tablet).
  -- Předává ho volající z řádku, který autorizuje; NULL = cesta zařízení neplatí.
  p_step_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
-- ⛔ COST NECHAT VÝCHOZÍ — NEZVEDAT (2026-09-30, revize kola 13, měřeno na produkci).
-- Kolo 13 sem dalo `COST 100000` („realistická cena ~0,56 ms"), aby planner
-- nepouštěl predikát před levný předfiltr. Jenže cenu restrikční podmínky účtuje
-- planner za KAŽDÝ PROSKENOVANÝ ŘÁDEK (costsize.c cost_seqscan: cpu_per_tuple
-- × baserel->tuples), ne za kandidáty, kteří k ní dojdou: sken kroků s predikátem
-- minus bez něj = 30 809,25 = přesně 123 237 × 0,25. S COST 100000 → +30,8 mil.
-- a get_kiosk_rozvozy by při každém volání kompiloval plný JIT. Pořadí drahého
-- predikátu se řeší PLOTEM u volajícího (MATERIALIZED CTE / množiny předem, viz
-- li_doc_slugs_claimed_by), ne cenou. Hlídá brána predikat-naroku-vychozi-cost.
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bound boolean := false;
BEGIN
  -- Oracle guard: přihlášený volající smí vyhodnocovat JEN SVOJI viditelnost;
  -- service_role / admin smí za kohokoliv (definer-interní volající předávají
  -- auth.uid() volajícího).
  -- ⛔ STRÁŽ MUSÍ BÝT ODOLNÁ VŮČI NULL (naměřeno 2026-09-19, tip kolegy z upstreamu).
  -- Tvar `IF NOT (p_x = auth.uid() OR …)` se při NEPŘIHLÁŠENÉM volajícím
  -- NEPROVEDE: `auth.uid()` je NULL, porovnání dá NULL, `NULL OR false OR false`
  -- je NULL, `NOT NULL` je NULL — a `IF NULL THEN` je stejné jako `IF false`.
  -- Stráž se tedy přeskočila a funkce odpověděla o TŘETÍ OSOBĚ přesně tomu,
  -- komu odpovídat neměla. `… IS NOT TRUE` zavírá: NULL i false vedou k zamítnutí.
  IF (p_uid = auth.uid() OR public.is_service_role() OR public.is_admin_or_staff()) IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- 4. Dispečerský rozsah. Konjunkce s rolí je JEDINÉ místo, kde se rozhoduje;
  --    žádný příznak z konfigurace ji neobejde, protože volající sem musí přijít.
  IF p_scope = 'dispatch' AND public.is_admin_or_staff() THEN
    RETURN true;
  END IF;

  -- 5. Účet zařízení (tablet). MUSÍ stát PŘED twin větví: kroky předání nesou
  --    `authorized_twin_id` a twin větev vrací výsledek hned, takže by sem nedošlo.
  --    Účet zařízení nemá roli ani přiřazení — jiná cesta ho nepustí.
  --    Krok pustí aktivní řádek `kiosk_rozsah` (DATA instance), který ho pokrývá (kód kroku
  --    + zúžení `input_match`); řádek s `jen_flotila` navíc jen krok NAŠÍ flotily —
  --    potvrzené párování řidiče nebo vozidla s Webdispečinkem (`kiosk_krok_nasi_flotily`;
  --    majitel 2026-09-30: „naše“ určuje párování, ne tablet). Přechod mezi řádky řídí data.
  IF p_step_code IS NOT NULL AND public.je_ucet_zarizeni_platny(p_uid) THEN
    RETURN EXISTS (
      SELECT 1 FROM public.kiosk_rozsah r
       WHERE r.aktivni
         AND r.step_code = p_step_code
         AND COALESCE(p_input, '{}'::jsonb) @> r.input_match
         AND (NOT r.jen_flotila OR public.kiosk_krok_nasi_flotily(COALESCE(p_input, '{}'::jsonb))));
  END IF;

  IF p_assigned_user IS NOT NULL AND p_assigned_user = p_uid THEN
    RETURN true;
  END IF;

  IF p_assigned_role IS NOT NULL AND public.has_role(p_uid, p_assigned_role) THEN
    RETURN true;
  END IF;

  -- Volitelná twin vazba — jen když je identity vrstva nainstalovaná.
  IF p_input ? 'authorized_twin_id'
     AND to_regclass('public.twin_external_refs') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM public.twin_external_refs r
        WHERE r.twin_id = $1::uuid
          AND r.ref_kind = 'account'
          AND r.source_key = $2::text
          AND r.state = 'confirmed'
          AND r.valid_from <= now()
          AND (r.valid_to IS NULL OR r.valid_to > now()))
    $q$
    INTO v_bound
    USING (p_input->>'authorized_twin_id'), p_uid;
    RETURN COALESCE(v_bound, false);
  END IF;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.workflow_step_visible_to(uuid,uuid,text,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workflow_step_visible_to(uuid,uuid,text,jsonb,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_step_visible_to(uuid,uuid,text,jsonb,text,text) TO service_role;
-- Pětiargumentový podpis (před F2) musí ZMIZET ze stejného důvodu jako čtyřargumentový
-- níž: volání s 5 argumenty by bylo nejednoznačné (42725), nebo by trefilo verzi BEZ
-- páté cesty. Nový podpis ho pokrývá výchozí hodnotou.
DROP FUNCTION IF EXISTS public.workflow_step_visible_to(uuid,uuid,text,jsonb,text);
-- Starý 4-argumentový podpis musí ZMIZET: `CREATE OR REPLACE` s novým DEFAULT
-- parametrem vytvoří DRUHOU funkci a volání se 4 argumenty by bylo nejednoznačné
-- (42725) — nebo hůř, trefilo by starou verzi BEZ dispečerské větve.
DROP FUNCTION IF EXISTS public.workflow_step_visible_to(uuid,uuid,text,jsonb);

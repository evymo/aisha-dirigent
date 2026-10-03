-- ============================================================================
-- Policy: li_source_registry_read — SLOUČENÝ čtecí nárok (admin/staff ∪ tier)
--
-- PROČ SLOUČENÍ A PŘEPIS (změřeno 2026-07-30 na produkční instanci, 43 157 řádků):
--   Do teď tabulka nesla TŘI permisivní SELECT policies, které se OR-ují:
--     li_source_registry_admin_select        USING (SELECT is_admin_or_staff())
--     li_source_registry_member_tier_select  USING document_visible_to(auth.uid(), source_sha256)
--     li_source_registry_read_admin          USING (SELECT is_admin_or_staff())   ← drift: v SoT NEBYLA
--   Predikát policy se vyhodnocuje PER ŘÁDEK. `(SELECT is_admin_or_staff())` je navíc
--   VOLATILE plpgsql, takže ji planner nesmí vytáhnout ani zopakovat: 43 157×
--   dvě volání + korelovaná `document_visible_to`. Naměřeno:
--     admin      10 405 ms   ·   uživatel bez nároku   41 252 ms  (a dostane 0 řádků)
--   Po tomto přepisu:      27 ms                          42 ms
--   Neoprávněný tedy platil NEJVÍC — jedním requestem vytížil DB na 41 s (DoS páka).
--
-- ČÍM SE TO OPRAVILO (dvě věci, ani jedna nemění nárok):
--   1. `(select public.is_admin_or_staff())` — poddotaz se vyhodnotí jako InitPlan
--      JEDNOU za dotaz. Pouhé přepnutí funkce na STABLE NESTAČÍ (změřeno: 10 509 ms) —
--      Postgres STABLE funkci z RLS qual sám nevytáhne, jen poddotaz.
--   2. Semi-join na promované doklady PŘED per-row funkcí. `document_visible_to`
--      si sensitivity čte z document_registry a `IF v_sensitivity IS NULL THEN
--      RETURN false` — doklad, který tam není, tedy UŽ DNES nepustí. Brána říká
--      totéž hromadně, takže per-row funkce se pro nepromované nevyvolá vůbec.
--
-- NÁROK JE NEZMĚNĚN — dokázáno porovnáním množin viditelných řádků:
--   admin      před 43 157 / md5 d6a19cc951e51383eac38131825981f7
--              po   43 157 / md5 d6a19cc951e51383eac38131825981f7
--   bez rolí   před 0 řádků · po 0 řádků
--   Formálně: `A OR B` → `A OR (brána AND B)`; přidaný AND konjunkt může množinu
--   jen zmenšit, nikdy zvětšit. `document_visible_to` zůstává JEDINÝM vlastníkem
--   tier pravidla (fail-closed, enforcement promotion švu) — nekopíruje se sem.
--
-- POZOR na „úklid": zrušit jen duplicitní read_admin a nechat dvojici
--   admin_select OR member_tier_select je 3× HORŠÍ (změřeno 30 419 ms) — bez
--   admin členu na PRVNÍM místě OR nemá co zkratovat a per-row jde
--   document_visible_to. Proto sloučení, ne mazání.
-- ============================================================================

DROP POLICY IF EXISTS li_source_registry_admin_select       ON public.li_source_registry;
DROP POLICY IF EXISTS li_source_registry_member_tier_select ON public.li_source_registry;
-- drift: policy existovala v živé DB, ale v SoT ne — bez tohoto dropu by v OR
-- zůstal per-row člen a celá oprava by neměla účinek.
DROP POLICY IF EXISTS li_source_registry_read_admin         ON public.li_source_registry;
DROP POLICY IF EXISTS li_source_registry_read               ON public.li_source_registry;

CREATE POLICY li_source_registry_read ON public.li_source_registry
  FOR SELECT
  TO authenticated
  USING (
    -- admin/staff: nárok na celou evidenci, vyhodnoceno JEDNOU (InitPlan)
    (SELECT public.is_admin_or_staff())
    -- ⭐ PLNÝ PŘÍSTUP K DATŮM (2026-09-28): udělený správou (zdroj `vse:*`) — všechny doklady
    -- bez výběru agend a firem; vyhodnoceno jednou za dotaz (InitPlan).
    OR (SELECT public.ma_plny_pristup_k_datum((SELECT auth.uid())))
    OR (
      -- člen: jen doklady PROMOVANÉ do document_registry (množinově, ne per-row)…
      source_sha256 IN (
        SELECT dr.source_sha256
        FROM public.document_registry dr
        WHERE dr.superseded_by IS NULL
      )
      -- …a z nich jen ty, na jejichž TŘÍDU × ÚROVEŇ má nárok (vlastník pravidla)
      AND public.document_visible_to((SELECT auth.uid()), source_sha256)
    )
    -- ─── STRUKTURÁLNÍ NÁROK: „tenhle doklad vezu já" ─────────────────────────
    --
    -- ⛔ NAMĚŘENO 2026-09-01: řetěz k dokladu končil naprázdno. Řidič svůj KROK
    -- vidí (workflow_step_visible_to přes authorized_twin_id + potvrzenou vazbu
    -- účtu), ale DOKLAD, ze kterého ten krok vznikl, ne — jediný nárok člena je
    -- tier × citlivost, tedy „jak vysoko jsem", ne „je to moje zásilka".
    -- Materiál a množství jsou přitom na dokladu; řidič je proto neviděl.
    --
    -- ⭐ VLASTNÍK PRAVIDLA SE NEMĚNÍ. Rozhoduje dál `workflow_step_visible_to`
    -- (BEZ rozsahu = „dosáhl bych na to i jako řadový uživatel"); tady je jen
    -- MNOŽINOVÉ spojení doklad↔běh. Žádná inline kopie predikátu — lekce P0 #824.
    --
    -- ⛔ PROČ MNOŽINOVĚ A NE per-row funkcí: táž lekce jako výš. Per-row predikát
    -- nad 43 157 doklady stál 41 252 ms a byl DoS pákou. Tenhle člen se
    -- vyhodnotí JEDNOU za dotaz a jde přes KROKY (řádově méně), ne přes doklady.
    --
    -- Spojkou je `doc_slug` v `input_data` uzlu — ukazatel na doklad, který tam
    -- zapisuje ingest (subject `@source_slug`). Běhy založené dřív ho nemají,
    -- takže tenhle člen na ně nedosáhne; je to rozšíření dopředu, ne migrace.
    OR doc_slug IN (
      -- ⛔ PŘES DEFINER, NE INLINE (naměřeno 2026-09-10). Výraz politiky běží pod
      -- rolí VOLAJÍCÍHO a `production_workflow_steps` má jedinou politiku,
      -- admin-only: inline poddotaz dával řidiči 0 řádků a člen nikdy nic
      -- nepustil. Kroky čte definer vlastníkem; rozsah drží jeho guard
      -- (jen svůj nárok) a rozhodovač zůstává jeden — `workflow_step_visible_to`.
      SELECT public.li_doc_slugs_claimed_by((SELECT auth.uid()))
    )
    -- ─── NÁROK Z VAZEB: „jsem spojen s identitou, které ten doklad patří" ────
    --
    -- ⭐ ROZHODNUTÍ MAJITELE 2026-09-28: běžný uživatel vidí smlouvy, faktury
    -- a dlužníky jen z identit, se kterými je spojen (účet → osoba → vazba →
    -- identita → potvrzený identifikátor == pole dokladu; pravidla jsou data
    -- instance v twin_scope_doc_rules). Přístup do sekce je zvlášť.
    -- Množinově přes DEFINER ze stejných důvodů jako člen výš: vazby, dvojčata
    -- i identifikátory čte pod rolí volajícího jen správa.
    OR doc_slug IN (
      SELECT public.li_doc_slugs_v_rozsahu((SELECT auth.uid()))
    )
  );

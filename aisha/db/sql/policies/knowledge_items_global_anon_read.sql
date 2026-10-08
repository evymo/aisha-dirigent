-- Policy: knowledge_items_global_anon_read ON public.knowledge_items
--
-- Čtení tabulky NAPŘÍMO (PostgREST) pro anonyma: jen aktivní globální položka
-- s viditelností `public`, v čitelném stavu a bez požadavku na úroveň členství.
--
-- Viditelnost rozhoduje JEDEN domov (public.knowledge_visibility_searchable) — týž jako
-- hledání a čtení podle id; politika se ho ptá přes public.knowledge_visibilities_for_caller()
-- (množina štítků pro identitu volajícího). Anonym identitu nemá, takže projde jen `public` (rozhodnutí majitele
-- 2026-10-04: nepřihlášený vidí jen public; do 2026-10-05 tu stál vlastní výčet ('public', 'members')).
--
-- ⛔ ZMĚŘENO 2026-10-04. Tabulka měla dvě politiky SELECT, obě PERMISSIVE a TO public.
-- PERMISSIVE se sčítají přes OR — a druhá („Per-story KB visible to participants“)
-- nesla větev `story_id IS NULL`, tedy pouštěla KAŽDOU globální položku bez ohledu na
-- status, viditelnost, úroveň i karanténu. Přihlášený tak přes tabulku přečetl koncepty,
-- soukromé položky, položky s úrovní i položky v karanténě, s celým tělem a pokyny —
-- mimo všechny filtry, které mají funkce. Anonyma nezastavila politika, ale NÁHODA:
-- druhá politika volala funkci, na kterou anon nemá EXECUTE, a dotaz spadl celý.
--
-- Proto čtyři politiky cílené na ROLE. Anonym je zastaven PREDIKÁTEM: tahle politika
-- nevolá nic, co by anon nesměl spustit (úroveň členství se pro něj neměří — položku
-- s úrovní prostě nedostane, stejně jako přes funkce, kde je auth.uid() NULL).
--
-- Tenhle soubor zároveň ZAHAZUJE obě staré politiky: na běžící databázi existují pod
-- starými jmény a vedle nových by se s nimi sečetly.
DROP POLICY IF EXISTS "Anyone can read active public knowledge items" ON public.knowledge_items;
DROP POLICY IF EXISTS "Per-story KB visible to participants" ON public.knowledge_items;

DROP POLICY IF EXISTS knowledge_items_global_anon_read ON public.knowledge_items;
CREATE POLICY knowledge_items_global_anon_read ON public.knowledge_items
  AS PERMISSIVE FOR SELECT TO anon
  USING (
    status = 'active'
    AND story_id IS NULL
    -- Množina štítků se spočítá jednou za dotaz (poddotaz bez vazby na řádek → InitPlan).
    AND visibility = ANY ((SELECT public.knowledge_visibilities_for_caller())::text[])
    -- Týž výčet jako public.knowledge_state_readable — politika ho nese doslova, protože
    -- se vyhodnocuje právy tazatele a ten funkci spustit nesmí. Shodu hlídá brána.
    AND quarantine_status IN ('clear', 'reviewed', 'reinstated')
    AND minimum_tier IS NULL
  );

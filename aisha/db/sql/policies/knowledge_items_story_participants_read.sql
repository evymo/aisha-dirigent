-- Policy: knowledge_items_story_participants_read ON public.knowledge_items
--
-- Položku PŘÍBĚHU čte napřímo jen jeho vlastník a účastník. Globální položky tahle
-- politika NEKRYJE (dřívější větev `story_id IS NULL` byla díra — viz
-- knowledge_items_global_anon_read.sql) a cizí příběh přes tabulku nevidí nikdo,
-- ani u typů core_value / personality_trait: ty vydávají funkce, ne tabulka.
--
-- BEZ filtru čitelného stavu záměrně: vlastník a účastník vidí svou položku i v karanténě —
-- jinak neví, že ji má, a nemá ji kdo posoudit. Karanténa chrání agenta před podvrženými
-- pokyny, ne člověka před jeho vlastním textem; filtr stavu nesou funkce, které obsah
-- vydávají agentovi.
--
-- `auth.uid()` na řádku nezávisí → poddotaz (InitPlan, jedno vyhodnocení za dotaz).
-- Oba EXISTS jsou korelované na `story_id` řádku, tam je vazba na řádek správně.
DROP POLICY IF EXISTS knowledge_items_story_participants_read ON public.knowledge_items;
CREATE POLICY knowledge_items_story_participants_read ON public.knowledge_items
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    story_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.partner_stories ps
        WHERE ps.id = knowledge_items.story_id
          AND ps.user_id = (SELECT auth.uid())
      )
      OR EXISTS (
        SELECT 1 FROM public.story_participants sp
        WHERE sp.story_id = knowledge_items.story_id
          AND sp.user_id = (SELECT auth.uid())
      )
    )
  );

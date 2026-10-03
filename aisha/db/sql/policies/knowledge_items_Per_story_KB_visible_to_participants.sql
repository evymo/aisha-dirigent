-- Policy: Per-story KB visible to participants ON public.knowledge_items
--
-- Predikáty, které NEZÁVISÍ na řádku, jsou obaleny do poddotazu → InitPlan:
-- `(SELECT is_admin_or_staff())` a `auth.uid()` se vyhodnotí JEDNOU za dotaz, ne pro každý
-- z 23 817 řádků (30 MB tabulka). Oba EXISTS zůstávají per-row záměrně — jsou
-- korelované na `knowledge_items.story_id`, takže je planner umí odjet jako
-- semi-join; per-row je tam správná vazba, ne režie.
--
-- Nárok NEZMĚNĚN: obalení do `(select …)` mění počet vyhodnocení, ne hodnotu.
-- Sesterská oprava k li_source_registry_read (změřeno 10 405 ms → 27 ms).

DROP POLICY IF EXISTS "Per-story KB visible to participants" ON public.knowledge_items;
CREATE POLICY "Per-story KB visible to participants" ON public.knowledge_items
  AS PERMISSIVE FOR SELECT TO public
  USING (
    ((item_type)::text = ANY (ARRAY['core_value'::text, 'personality_trait'::text]))
    OR (story_id IS NULL)
    OR (SELECT is_admin_or_staff())
    OR (EXISTS (
      SELECT 1 FROM partner_stories ps
      WHERE ps.id = knowledge_items.story_id
        AND ps.user_id = (SELECT auth.uid())
    ))
    OR (EXISTS (
      SELECT 1 FROM story_participants sp
      WHERE sp.story_id = knowledge_items.story_id
        AND sp.user_id = (SELECT auth.uid())
    ))
  );

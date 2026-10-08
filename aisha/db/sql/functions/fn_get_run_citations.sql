-- ============================================================================
-- Source of Truth: fn_get_run_citations
-- Step:  Step 2 of retrieval optimization plan 2026
-- Used by: src/hooks/useRunCitations.ts → CitationPanel.tsx
-- Migration: aisha/db/migrations/20260518220000_chat_message_eval_link.sql
-- Patched by: aisha/db/migrations/20260519030000_fix_owner_user_id_typo.sql
--             (ps.owner_user_id → ps.user_id — partner_stories.owner_user_id
--             was never a column; the canonical owner reference is user_id).
-- Patched by: aisha/db/migrations/20260520060000_rbac_4clause_unification.sql
--             (added is_stack_default clause so the predicate matches the
--             workbench Phase 6/7 canonical pattern).
-- Viditelnost (2026-10-05): GLOBÁLNÍ citovaná položka jen s viditelností, kterou volajícímu dává
-- jeden domov (public.knowledge_visibility_searchable); správa vidí vše. Do 2026-10-05 se u globální
-- položky viditelnost nečetla: kdokoli přihlášený, kdo znal id běhu, dostal úryvky i soukromé položky,
-- kterou běh správy citoval. Položka příběhu podle pravidel příběhu (vlastník, účastník, správa); ve
-- výchozím příběhu instance navíc podle domova viditelnosti — do 2026-10-05 tu výchozí příběh pouštěl
-- KAŽDOU svou položku komukoli přihlášenému, i soukromou (revize, B2; id běhu zná každý účastník).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_run_citations(p_run_id uuid)
RETURNS TABLE (
  chunk_id            uuid,
  chunk_index         integer,
  chunk_text          text,
  contextual_prefix   text,
  item_id             uuid,
  item_title          text,
  item_type           text,
  section_title       text,
  story_id            uuid,
  relevance_score     numeric,
  attribution_weight  numeric,
  usage_intensity     numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
STABLE
AS $$
DECLARE
  -- viditelnost globálních položek pro volajícího (bez identity jen `public`)
  v_in_guild boolean := public.knowledge_audience_in_guild(auth.uid());
  v_is_admin boolean := COALESCE(public.is_admin_or_staff(auth.uid()), false);
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH attrs AS (
    -- Sloupce VŽDY s aliasem tabulky: jména relevance_score, attribution_weight, chunk_id… jsou
    -- zároveň výstupní parametry (RETURNS TABLE) a bez kvalifikace je PL/pgSQL odmítne jako
    -- nejednoznačná (42702). Do 2026-10-04 tak KAŽDÉ volání skončilo chybou.
    SELECT
      ka.knowledge_item_id,
      ka.relevance_score,
      ka.attribution_weight,
      ka.usage_intensity
    FROM public.knowledge_attribution ka
    WHERE ka.ai_run_id = p_run_id
  ),
  candidate_chunks AS (
    SELECT
      kc.id AS chunk_id,
      kc.chunk_index,
      kc.chunk_text,
      kc.contextual_prefix,
      ki.id AS item_id,
      ki.title AS item_title,
      ki.item_type::text AS item_type,
      ki.visibility AS item_visibility,
      kc.section_title,
      ki.story_id AS story_id,
      a.relevance_score,
      a.attribution_weight,
      a.usage_intensity
    FROM attrs a
    JOIN public.knowledge_items ki ON ki.id = a.knowledge_item_id
    LEFT JOIN public.knowledge_chunks kc ON kc.knowledge_item_id = ki.id
   WHERE ki.status = 'active'
     AND public.knowledge_state_readable(ki.quarantine_status)
  )
  SELECT
    cc.chunk_id,
    cc.chunk_index,
    cc.chunk_text,
    cc.contextual_prefix,
    cc.item_id,
    cc.item_title,
    cc.item_type,
    cc.section_title,
    cc.story_id,
    cc.relevance_score,
    cc.attribution_weight,
    cc.usage_intensity
  FROM candidate_chunks cc
   WHERE (cc.story_id IS NULL
          AND (v_is_admin OR public.knowledge_visibility_searchable(cc.item_visibility, auth.uid() IS NOT NULL, v_in_guild)))
      OR EXISTS (
           SELECT 1
             FROM public.partner_stories ps
            WHERE ps.id = cc.story_id
              AND (
                v_is_admin
                -- výchozí příběh: jen to, co dává domov viditelnosti (bez vlastního výčtu)
                OR (ps.is_stack_default AND public.knowledge_visibility_searchable(cc.item_visibility, auth.uid() IS NOT NULL, v_in_guild))
                OR ps.user_id = auth.uid()
                OR EXISTS (
                     SELECT 1 FROM public.story_participants sp
                      WHERE sp.story_id = ps.id AND sp.user_id = auth.uid()
                   )
              )
         )
   ORDER BY cc.attribution_weight DESC NULLS LAST, cc.chunk_index ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_run_citations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_run_citations(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_run_citations(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_get_run_citations(uuid) IS
  'Step 2: returns chunks the ai_run cited (via knowledge_attribution). Story-scoped RBAC via unified 4-clause predicate (admin/staff, stack_default, story owner, or participant).';

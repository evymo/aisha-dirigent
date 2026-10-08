-- Function: public.list_story_knowledge_items
-- Description: Lists knowledge_items scoped to a story for the Phase 8
--   StoryKnowledgeTab UI. Returns items where story_id = p_story_id with
--   tag arrays, category, ingestion safety status, and basic metadata —
--   excludes body_markdown payload by default (use mcp_get_knowledge_item
--   for full body when an item is opened).
-- Security: SECURITY DEFINER. Admin/staff OR story owner OR story_participants member OR
--   stack-default story — matches kanban_stories_view / story_timeline.

CREATE OR REPLACE FUNCTION public.list_story_knowledge_items(
  p_story_id uuid,
  p_include_archived boolean DEFAULT false
)
RETURNS TABLE (
  id                 uuid,
  item_type          text,
  title              text,
  summary            text,
  category           text,
  ai_context_tags    text[],
  status             text,
  visibility         text,
  version            int,
  author_display_name text,
  is_verified        boolean,
  quarantine_status  text,
  safety_score       numeric,
  created_at         timestamptz,
  updated_at         timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_is_admin boolean := false;
  -- Plný přístup k příběhu (správa, vlastník, účastník): i položky v karanténě a s jakoukoli viditelností.
  v_plny     boolean := false;
  v_in_guild boolean := public.knowledge_audience_in_guild(auth.uid());
BEGIN
  IF v_user_id IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_is_admin := COALESCE(public.is_admin_or_staff(v_user_id), false);
  -- Vlastník příběhu (2026-10-05): pravidla příběhu jsou všude stejná — vlastník, účastník, správa
  -- (hledání v2/v3, čtení podle id, politika tabulky). Do 2026-10-05 tu vlastník chyběl: kdo příběh
  -- založil a sám se nepřidal mezi účastníky, svou položku tu nedostal (změřeno).
  v_plny := v_is_admin OR EXISTS (
    SELECT 1 FROM public.partner_stories ps
     WHERE ps.id = p_story_id
       AND (ps.user_id = v_user_id
            OR EXISTS (SELECT 1 FROM public.story_participants sp WHERE sp.story_id = ps.id AND sp.user_id = v_user_id))
  );

  -- Výchozí příběh instance (is_stack_default) smí seznam otevřít každý — ale bez plného přístupu jen
  -- AKTIVNÍ položky, které mu dává domov viditelnosti, a jen v čitelném stavu (níž). Do 2026-10-05 tu
  -- výchozí příběh otevíral VŠECHNY své položky komukoli přihlášenému, i soukromé a v karanténě (revize,
  -- B2); do 2026-10-05 (revize 2, N1) bez plného přístupu i archivované (s p_include_archived) a
  -- pending_review — ty smí jen správa, vlastník a účastník, stejně jako u globálních položek jen `active`.
  IF NOT v_plny
     AND NOT EXISTS (
       SELECT 1 FROM public.partner_stories ps
       WHERE ps.id = p_story_id AND ps.is_stack_default = true
     )
  THEN
    RAISE EXCEPTION 'Access denied: story participant or admin/staff required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    ki.id,
    ki.item_type::text,
    ki.title,
    ki.summary,
    ki.category,
    COALESCE(ki.ai_context_tags, '{}'::text[]) AS ai_context_tags,
    ki.status,
    ki.visibility,
    ki.version,
    ki.author_display_name,
    ki.is_verified,
    ki.quarantine_status,
    ki.safety_score,
    ki.created_at,
    ki.updated_at
  FROM public.knowledge_items ki
  WHERE ki.story_id = p_story_id
    AND (p_include_archived OR ki.status NOT IN ('archived', 'deleted'))
    AND (
      v_plny
      OR (ki.status = 'active'
          AND public.knowledge_visibility_searchable(ki.visibility, v_user_id IS NOT NULL, v_in_guild)
          AND public.knowledge_state_readable(ki.quarantine_status))
    )
  ORDER BY ki.updated_at DESC, ki.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_story_knowledge_items(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_story_knowledge_items(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_story_knowledge_items(uuid, boolean) TO service_role;

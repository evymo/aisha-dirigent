-- Function: public.list_story_knowledge_items
-- Description: Lists knowledge_items scoped to a story for the Phase 8
--   StoryKnowledgeTab UI. Returns items where story_id = p_story_id with
--   tag arrays, category, ingestion safety status, and basic metadata —
--   excludes body_markdown payload by default (use mcp_get_knowledge_item
--   for full body when an item is opened).
-- Security: SECURITY DEFINER. Admin/staff OR story_participants member OR
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
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_user_id IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.is_admin_or_staff(v_user_id);

  IF NOT v_is_admin
     AND NOT EXISTS (
       SELECT 1 FROM public.partner_stories ps
       WHERE ps.id = p_story_id
         AND (
           ps.is_stack_default = true
           OR EXISTS (
             SELECT 1 FROM public.story_participants sp
             WHERE sp.story_id = ps.id AND sp.user_id = v_user_id
           )
         )
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
  ORDER BY ki.updated_at DESC, ki.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_story_knowledge_items(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_story_knowledge_items(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_story_knowledge_items(uuid, boolean) TO service_role;

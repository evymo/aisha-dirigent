-- Function: public.list_agent_kb_bindings
-- Description: Returns one row per (agent, knowledge_item) binding for a
--   given story, joined with the expert_rules metadata the matrix UI
--   needs to render rich rows. Includes both story-scoped (story_id =
--   p_story_id) AND global (story_id IS NULL) bindings so the matrix can
--   show which globals apply to this story too.
-- Security: SECURITY DEFINER. Same admin-or-participant gate as
--   story_timeline / kanban_stories_view.

CREATE OR REPLACE FUNCTION public.list_agent_kb_bindings(
  p_story_id uuid,
  p_agent_slug text DEFAULT NULL
)
RETURNS TABLE (
  binding_id        uuid,
  agent_slug        text,
  knowledge_item_id uuid,
  knowledge_title   text,
  knowledge_slug    text,
  knowledge_category text,
  knowledge_status  text,
  binding_type      text,
  priority          int,
  version           int,
  is_active         boolean,
  story_id          uuid,
  is_global         boolean,
  notes             text,
  created_at        timestamptz,
  updated_at        timestamptz,
  created_by        uuid
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
    akb.id                          AS binding_id,
    akb.agent_slug,
    akb.knowledge_item_id,
    er.title                        AS knowledge_title,
    er.slug                         AS knowledge_slug,
    er.category::text               AS knowledge_category,
    er.status::text                 AS knowledge_status,
    akb.binding_type,
    akb.priority,
    akb.version,
    akb.is_active,
    akb.story_id,
    (akb.story_id IS NULL)          AS is_global,
    akb.notes,
    akb.created_at,
    akb.updated_at,
    akb.created_by
  FROM public.agent_knowledge_bindings akb
  JOIN public.expert_rules er ON er.id = akb.knowledge_item_id
    AND public.expert_rule_visible_to(er.visibility, er.author_partner_id, auth.uid())
  WHERE (akb.story_id = p_story_id OR akb.story_id IS NULL)
    AND (p_agent_slug IS NULL OR akb.agent_slug = p_agent_slug)
  ORDER BY
    akb.agent_slug ASC,
    akb.priority DESC,
    er.title ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_agent_kb_bindings(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_agent_kb_bindings(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_agent_kb_bindings(uuid, text) TO service_role;

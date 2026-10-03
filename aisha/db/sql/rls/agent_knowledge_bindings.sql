-- RLS: agent_knowledge_bindings
-- Admin/staff manage all; story participants can read bindings scoped to
-- their stories; everyone authenticated can read global (story_id NULL)
-- bindings since those drive cross-story agent behavior the user can
-- observe anyway through AISHA's responses.

ALTER TABLE public.agent_knowledge_bindings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_can_read_global_or_participant_bindings" ON public.agent_knowledge_bindings;
CREATE POLICY "authenticated_can_read_global_or_participant_bindings"
  ON public.agent_knowledge_bindings
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    story_id IS NULL
    OR (SELECT public.is_admin_or_staff())
    OR EXISTS (
      SELECT 1 FROM public.story_participants sp
      WHERE sp.story_id = agent_knowledge_bindings.story_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "admin_staff_can_manage_agent_knowledge_bindings" ON public.agent_knowledge_bindings;
CREATE POLICY "admin_staff_can_manage_agent_knowledge_bindings"
  ON public.agent_knowledge_bindings
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT public.is_admin_or_staff()))
  WITH CHECK ((SELECT public.is_admin_or_staff()));

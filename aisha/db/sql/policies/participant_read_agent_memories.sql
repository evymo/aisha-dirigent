-- Policy: participant_read_agent_memories
-- Lets a story_participants member SELECT agent_memories whose source_run_id
-- chains to one of their stories. Hippocampus signals captured during the
-- story's runs become visible to the participant (PII-masked preview via
-- list_hippocampus_signals; full content still requires admin/staff via
-- reveal_hippocampus_content_audited).

CREATE POLICY "participant_read_agent_memories"
  ON public.agent_memories
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    agent_memories.source_run_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.ai_runs ar
        JOIN public.story_participants sp ON sp.story_id = ar.story_id
        WHERE ar.id = agent_memories.source_run_id
          AND sp.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.ai_runs ar
        JOIN public.partner_stories ps ON ps.id = ar.story_id
        WHERE ar.id = agent_memories.source_run_id
          AND ps.is_stack_default = true
      )
    )
  );

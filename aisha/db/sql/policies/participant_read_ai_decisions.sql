-- Policy: participant_read_ai_decisions
-- Lets a story_participants member SELECT ai_decisions for their stories
-- (mirror of participant_read_ai_trace_events). Stack-default stories are
-- readable so platform AI decisions stay visible.

CREATE POLICY "participant_read_ai_decisions"
  ON public.ai_decisions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.story_participants sp
      WHERE sp.story_id = ai_decisions.story_id
        AND sp.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.partner_stories ps
      WHERE ps.id = ai_decisions.story_id
        AND ps.is_stack_default = true
    )
  );

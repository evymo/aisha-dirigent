-- Policy: participant_read_ai_trace_events
-- Lets a story_participants member SELECT ai_trace_events whose run_id
-- chains to one of their stories via ai_runs.story_id.

CREATE POLICY "participant_read_ai_trace_events"
  ON public.ai_trace_events
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.ai_runs ar
      JOIN public.story_participants sp ON sp.story_id = ar.story_id
      WHERE ar.id = ai_trace_events.run_id
        AND sp.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.ai_runs ar
      JOIN public.partner_stories ps ON ps.id = ar.story_id
      WHERE ar.id = ai_trace_events.run_id
        AND ps.is_stack_default = true
    )
  );

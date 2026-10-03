-- Policy: participant_read_ai_runs
-- Lets a story_participants member SELECT ai_runs rows scoped to their
-- story. ai_runs without story_id (system runs / one-off chat outside a
-- story) remain admin/staff-only via the existing admin_staff_read_ai_runs
-- policy.

CREATE POLICY "participant_read_ai_runs"
  ON public.ai_runs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    ai_runs.story_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.story_participants sp
        WHERE sp.story_id = ai_runs.story_id
          AND sp.user_id  = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.partner_stories ps
        WHERE ps.id = ai_runs.story_id
          AND ps.is_stack_default = true
      )
    )
  );

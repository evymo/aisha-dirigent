-- Policy: participant_read_story_rulesets
-- Lets a story_participants member SELECT story_rulesets bound to their
-- story. Admin/staff manage policy continues to apply (PERMISSIVE OR).

CREATE POLICY "participant_read_story_rulesets"
  ON public.story_rulesets
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.story_participants sp
      WHERE sp.story_id = story_rulesets.story_id
        AND sp.user_id  = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.partner_stories ps
      WHERE ps.id = story_rulesets.story_id
        AND ps.is_stack_default = true
    )
  );

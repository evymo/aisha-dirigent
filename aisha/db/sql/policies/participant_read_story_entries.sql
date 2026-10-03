-- Policy: participant_read_story_entries
-- Lets a story_participants member SELECT story_entries rows of their
-- story (read-only). Stack-default story is implicitly visible to every
-- authenticated user via the existing partner_stories policy; we don't
-- need to re-grant story_entries here because story_entries.story_id
-- still has to match a partner_stories row the user can already see.
-- Admin/staff manage policy from Admin_can_manage_all_story_entries
-- continues to apply (PERMISSIVE OR).

CREATE POLICY "participant_read_story_entries"
  ON public.story_entries
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.story_participants sp
      WHERE sp.story_id = story_entries.story_id
        AND sp.user_id  = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.partner_stories ps
      WHERE ps.id = story_entries.story_id
        AND ps.is_stack_default = true
    )
  );

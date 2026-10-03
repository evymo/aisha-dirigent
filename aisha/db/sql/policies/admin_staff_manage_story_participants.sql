-- Policy: admin_staff_manage_story_participants

DROP POLICY IF EXISTS "admin_staff_manage_story_participants" ON public.story_participants;
CREATE POLICY "admin_staff_manage_story_participants" ON public.story_participants
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()));

-- Policy: Story members can view room mappings

CREATE POLICY "Story members can view room mappings" ON public.story_matrix_rooms
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1 FROM story_participants sm WHERE ((sm.story_id = story_matrix_rooms.story_id) AND (sm.user_id = auth.uid())))));

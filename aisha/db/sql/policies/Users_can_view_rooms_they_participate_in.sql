-- Policy: Users can view rooms they participate in

CREATE POLICY "Users can view rooms they participate in" ON public.voice_rooms
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((auth.uid() = created_by) OR (EXISTS ( SELECT 1 FROM call_participants cp WHERE ((cp.voice_room_id = voice_rooms.id) AND (cp.user_id = auth.uid())))) OR (EXISTS ( SELECT 1 FROM story_participants sm WHERE ((sm.story_id = voice_rooms.story_id) AND (sm.user_id = auth.uid()))))));

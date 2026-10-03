-- Policy: Participants can view room members

CREATE POLICY "Participants can view room members" ON public.call_participants
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1 FROM call_participants cp2 WHERE ((cp2.voice_room_id = call_participants.voice_room_id) AND (cp2.user_id = auth.uid())))));

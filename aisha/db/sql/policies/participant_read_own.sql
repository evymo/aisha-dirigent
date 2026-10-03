-- Policy: participant_read_own

CREATE POLICY "participant_read_own" ON public.story_participants
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()));

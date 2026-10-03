-- Policy: Users can view own token events

CREATE POLICY "Users can view own token events" ON public.production_token_events
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = participant_id));

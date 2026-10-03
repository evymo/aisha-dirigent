-- Policy: Users can update own health states

CREATE POLICY "Users can update own health states" ON public.member_health_states
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

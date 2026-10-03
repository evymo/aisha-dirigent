-- Policy: Users can create own health states

CREATE POLICY "Users can create own health states" ON public.member_health_states
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((user_id = auth.uid()));

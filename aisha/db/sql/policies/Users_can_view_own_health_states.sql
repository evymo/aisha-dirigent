-- Policy: Users can view own health states

CREATE POLICY "Users can view own health states" ON public.member_health_states
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()));

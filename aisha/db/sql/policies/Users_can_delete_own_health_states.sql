-- Policy: Users can delete own health states

CREATE POLICY "Users can delete own health states" ON public.member_health_states
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((user_id = auth.uid()));

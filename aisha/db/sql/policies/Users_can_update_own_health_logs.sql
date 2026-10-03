-- Policy: Users can update own health logs

CREATE POLICY "Users can update own health logs" ON public.member_health_logs
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

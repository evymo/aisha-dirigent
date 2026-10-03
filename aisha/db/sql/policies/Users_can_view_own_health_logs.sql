-- Policy: Users can view own health logs

CREATE POLICY "Users can view own health logs" ON public.member_health_logs
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()));

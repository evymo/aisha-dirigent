-- Policy: Users can create own health logs

CREATE POLICY "Users can create own health logs" ON public.member_health_logs
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((user_id = auth.uid()));

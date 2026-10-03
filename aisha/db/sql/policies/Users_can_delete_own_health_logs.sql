-- Policy: Users can delete own health logs

CREATE POLICY "Users can delete own health logs" ON public.member_health_logs
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((user_id = auth.uid()));

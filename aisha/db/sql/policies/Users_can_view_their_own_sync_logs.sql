-- Policy: Users can view their own sync logs

CREATE POLICY "Users can view their own sync logs" ON public.health_data_sync_log
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()));

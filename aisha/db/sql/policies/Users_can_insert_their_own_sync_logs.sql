-- Policy: Users can insert their own sync logs

CREATE POLICY "Users can insert their own sync logs" ON public.health_data_sync_log
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((user_id = auth.uid()));

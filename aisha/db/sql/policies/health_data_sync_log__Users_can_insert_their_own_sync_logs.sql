-- Policy: Users can insert their own sync logs
-- Table: health_data_sync_log
-- Operation: INSERT

CREATE POLICY "Users can insert their own sync logs"
  ON public.health_data_sync_log
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

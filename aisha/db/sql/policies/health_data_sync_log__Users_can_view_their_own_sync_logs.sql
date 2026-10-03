-- Policy: Users can view their own sync logs
-- Table: health_data_sync_log
-- Operation: SELECT

CREATE POLICY "Users can view their own sync logs"
  ON public.health_data_sync_log
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

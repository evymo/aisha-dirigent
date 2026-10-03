-- Policy: Admins can view all sync logs
-- Table: health_data_sync_log
-- Operation: SELECT

DROP POLICY IF EXISTS "Admins can view all sync logs" ON public.health_data_sync_log;
CREATE POLICY "Admins can view all sync logs"
  ON public.health_data_sync_log
  FOR SELECT
  TO authenticated
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));

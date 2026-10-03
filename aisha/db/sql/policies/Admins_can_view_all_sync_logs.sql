-- Policy: Admins can view all sync logs

DROP POLICY IF EXISTS "Admins can view all sync logs" ON public.health_data_sync_log;
CREATE POLICY "Admins can view all sync logs" ON public.health_data_sync_log
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));

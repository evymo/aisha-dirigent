-- Policy: Admins can view notification logs

DROP POLICY IF EXISTS "Admins can view notification logs" ON public.notification_logs;
CREATE POLICY "Admins can view notification logs" ON public.notification_logs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));

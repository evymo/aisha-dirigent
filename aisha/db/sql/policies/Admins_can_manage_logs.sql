-- Policy: Admins can manage logs

DROP POLICY IF EXISTS "Admins can manage logs" ON public.production_logs;
CREATE POLICY "Admins can manage logs" ON public.production_logs
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

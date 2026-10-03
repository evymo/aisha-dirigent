-- Policy: Admin full access to health logs

DROP POLICY IF EXISTS "Admin full access to health logs" ON public.member_health_logs;
CREATE POLICY "Admin full access to health logs" ON public.member_health_logs
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))))
  WITH CHECK ((SELECT is_admin_or_staff((SELECT auth.uid()))));

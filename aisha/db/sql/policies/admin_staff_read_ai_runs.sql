-- Policy: admin_staff_read_ai_runs

DROP POLICY IF EXISTS "admin_staff_read_ai_runs" ON public.ai_runs;
CREATE POLICY "admin_staff_read_ai_runs" ON public.ai_runs
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()));

-- Policy: Admin/staff can manage eval runs

DROP POLICY IF EXISTS "Admin/staff can manage eval runs" ON public.ai_eval_runs;
CREATE POLICY "Admin/staff can manage eval runs" ON public.ai_eval_runs
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()))
  WITH CHECK ((SELECT is_admin_or_staff()));

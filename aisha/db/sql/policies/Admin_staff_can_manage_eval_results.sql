-- Policy: Admin/staff can manage eval results

DROP POLICY IF EXISTS "Admin/staff can manage eval results" ON public.ai_eval_results;
CREATE POLICY "Admin/staff can manage eval results" ON public.ai_eval_results
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()))
  WITH CHECK ((SELECT is_admin_or_staff()));

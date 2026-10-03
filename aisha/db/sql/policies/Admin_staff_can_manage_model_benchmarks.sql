-- Policy: Admin/staff can manage model benchmarks

DROP POLICY IF EXISTS "Admin/staff can manage model benchmarks" ON public.ai_model_benchmarks;
CREATE POLICY "Admin/staff can manage model benchmarks" ON public.ai_model_benchmarks
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()))
  WITH CHECK ((SELECT is_admin_or_staff()));

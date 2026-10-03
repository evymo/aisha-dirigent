-- Policy: rag_eval_runs read admin staff

DROP POLICY IF EXISTS "rag_eval_runs read admin staff" ON public.rag_eval_runs;
CREATE POLICY "rag_eval_runs read admin staff" ON public.rag_eval_runs
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

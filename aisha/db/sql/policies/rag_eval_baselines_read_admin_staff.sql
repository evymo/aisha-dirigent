-- Policy: rag_eval_baselines read admin staff

DROP POLICY IF EXISTS "rag_eval_baselines read admin staff" ON public.rag_eval_baselines;
CREATE POLICY "rag_eval_baselines read admin staff" ON public.rag_eval_baselines
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

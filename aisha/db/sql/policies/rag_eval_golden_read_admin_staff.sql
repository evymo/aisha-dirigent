-- Policy: rag_eval_golden read admin staff

DROP POLICY IF EXISTS "rag_eval_golden read admin staff" ON public.rag_eval_golden;
CREATE POLICY "rag_eval_golden read admin staff" ON public.rag_eval_golden
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

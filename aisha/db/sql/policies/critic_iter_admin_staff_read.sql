-- Policy: critic_iter admin staff read

DROP POLICY IF EXISTS "critic_iter admin staff read" ON public.ai_run_critic_iterations;
CREATE POLICY "critic_iter admin staff read" ON public.ai_run_critic_iterations
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

-- Policy: Service role full access to tasks

CREATE POLICY "Service role full access to tasks" ON public.ai_tasks
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.role() = 'service_role'::text));

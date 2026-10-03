-- Policy: Service role full access to user memory

CREATE POLICY "Service role full access to user memory" ON public.ai_user_memory
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.role() = 'service_role'::text));

-- Policy: Service role full access to session memory

CREATE POLICY "Service role full access to session memory" ON public.ai_session_memory
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.role() = 'service_role'::text));

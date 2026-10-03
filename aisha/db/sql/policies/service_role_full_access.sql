-- Policy: service_role_full_access

CREATE POLICY "service_role_full_access" ON public.agent_memories
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((current_setting('role'::text, true) = 'service_role'::text));

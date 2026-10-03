-- Policy: admin_staff_full_access

DROP POLICY IF EXISTS "admin_staff_full_access" ON public.agent_memories;
CREATE POLICY "admin_staff_full_access" ON public.agent_memories
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()));

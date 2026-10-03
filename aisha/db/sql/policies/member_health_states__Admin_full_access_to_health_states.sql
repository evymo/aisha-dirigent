-- Policy: Admin full access to health states

DROP POLICY IF EXISTS "Admin full access to health states" ON public.member_health_states;
CREATE POLICY "Admin full access to health states" ON public.member_health_states
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))))
  WITH CHECK ((SELECT is_admin_or_staff((SELECT auth.uid()))));

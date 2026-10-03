-- Policy: surface_actions_service_all
DROP POLICY IF EXISTS surface_actions_service_all ON public.surface_actions;
CREATE POLICY surface_actions_service_all ON public.surface_actions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

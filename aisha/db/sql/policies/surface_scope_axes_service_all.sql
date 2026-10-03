-- Zápis jen service_role: osy zakládá overlay instance při nasazení, ne uživatel.
DROP POLICY IF EXISTS surface_scope_axes_service_all ON public.surface_scope_axes;
CREATE POLICY surface_scope_axes_service_all ON public.surface_scope_axes
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

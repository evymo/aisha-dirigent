-- Policy: service_role plný přístup.

DROP POLICY IF EXISTS surface_layouts_service_all ON public.surface_layouts;
CREATE POLICY surface_layouts_service_all ON public.surface_layouts
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

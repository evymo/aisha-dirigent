-- Policy: service_role plný přístup.

DROP POLICY IF EXISTS surface_blocks_service_all ON public.surface_blocks;
CREATE POLICY surface_blocks_service_all ON public.surface_blocks
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

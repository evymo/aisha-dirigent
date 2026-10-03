-- Policy: service_role plný přístup (emitor snímků).

DROP POLICY IF EXISTS surface_snapshots_service_all ON public.surface_snapshots;
CREATE POLICY surface_snapshots_service_all ON public.surface_snapshots
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

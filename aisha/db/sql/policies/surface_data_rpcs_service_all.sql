-- Policy: service_role plný přístup (seed/administrace přes audited RPC).

DROP POLICY IF EXISTS surface_data_rpcs_service_all ON public.surface_data_rpcs;
CREATE POLICY surface_data_rpcs_service_all ON public.surface_data_rpcs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

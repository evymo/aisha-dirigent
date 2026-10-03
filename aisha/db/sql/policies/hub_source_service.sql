-- Policy: hub_source_service

DROP POLICY IF EXISTS hub_source_service ON public.hub_source;
CREATE POLICY hub_source_service ON public.hub_source
  FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

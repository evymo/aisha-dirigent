-- Policy: hub_attribute_source_service

DROP POLICY IF EXISTS hub_attribute_source_service ON public.hub_attribute_source;
CREATE POLICY hub_attribute_source_service ON public.hub_attribute_source
  FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

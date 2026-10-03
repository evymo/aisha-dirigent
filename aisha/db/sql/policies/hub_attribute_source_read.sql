-- Policy: hub_attribute_source_read

DROP POLICY IF EXISTS hub_attribute_source_read ON public.hub_attribute_source;
CREATE POLICY hub_attribute_source_read ON public.hub_attribute_source
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));

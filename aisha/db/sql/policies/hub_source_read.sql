-- Policy: hub_source_read

DROP POLICY IF EXISTS hub_source_read ON public.hub_source;
CREATE POLICY hub_source_read ON public.hub_source
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));

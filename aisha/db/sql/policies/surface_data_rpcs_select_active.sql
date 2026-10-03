-- Policy: authenticated čte jen aktivní řádky allowlistu (default deny jinak).

DROP POLICY IF EXISTS surface_data_rpcs_select_active ON public.surface_data_rpcs;
CREATE POLICY surface_data_rpcs_select_active ON public.surface_data_rpcs
  FOR SELECT TO authenticated
  USING (is_active = true);

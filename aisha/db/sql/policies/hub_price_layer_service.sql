-- Policy: hub_price_layer_service

DROP POLICY IF EXISTS hub_price_layer_service ON public.hub_price_layer;
CREATE POLICY hub_price_layer_service ON public.hub_price_layer
  FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

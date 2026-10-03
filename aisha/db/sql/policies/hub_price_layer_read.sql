-- Policy: hub_price_layer_read

DROP POLICY IF EXISTS hub_price_layer_read ON public.hub_price_layer;
CREATE POLICY hub_price_layer_read ON public.hub_price_layer
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));

-- Policy: hub_supplier_offer_service

DROP POLICY IF EXISTS hub_supplier_offer_service ON public.hub_supplier_offer;
CREATE POLICY hub_supplier_offer_service ON public.hub_supplier_offer FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

-- Policy: hub_supplier_offer_read

DROP POLICY IF EXISTS hub_supplier_offer_read ON public.hub_supplier_offer;
CREATE POLICY hub_supplier_offer_read ON public.hub_supplier_offer FOR SELECT USING ((SELECT public.is_admin_or_staff()));

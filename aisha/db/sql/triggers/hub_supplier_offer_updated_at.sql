-- Trigger: hub_supplier_offer_updated_at
-- Source of truth pair: aisha/db/sql/tables/hub_supplier_offer.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER
-- functions in the baseline) so public.set_updated_at() exists when it binds —
-- inline-in-table placement breaks cold-start ordering (tables precede functions).

DROP TRIGGER IF EXISTS hub_supplier_offer_updated_at ON public.hub_supplier_offer;
CREATE TRIGGER hub_supplier_offer_updated_at
  BEFORE UPDATE ON public.hub_supplier_offer
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

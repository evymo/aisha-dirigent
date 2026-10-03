-- Trigger: shipment_dispatch_records_updated_at
-- Table: shipment_dispatch_records

CREATE TRIGGER shipment_dispatch_records_updated_at
  BEFORE UPDATE ON public.shipment_dispatch_records
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

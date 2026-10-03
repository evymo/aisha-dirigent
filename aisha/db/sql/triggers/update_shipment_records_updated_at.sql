-- Trigger: update_shipment_records_updated_at
-- Table: shipment_records

CREATE TRIGGER update_shipment_records_updated_at
    BEFORE UPDATE ON public.shipment_records
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

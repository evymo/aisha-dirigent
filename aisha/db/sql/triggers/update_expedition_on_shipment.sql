-- Trigger: update_expedition_on_shipment
-- Table: shipment_records

CREATE TRIGGER update_expedition_on_shipment
AFTER INSERT OR UPDATE
ON public.shipment_records
FOR EACH ROW
EXECUTE FUNCTION update_expedition_on_shipment_change();

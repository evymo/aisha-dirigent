-- Trigger: update_shipment_settings_updated_at
-- Table: shipment_settings

CREATE TRIGGER update_shipment_settings_updated_at
    BEFORE UPDATE ON public.shipment_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger: update_user_shipment_preferences_updated_at
-- Table: user_shipment_preferences

CREATE TRIGGER update_user_shipment_preferences_updated_at
    BEFORE UPDATE ON public.user_shipment_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

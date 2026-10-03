-- Trigger: update_member_wearable_connections_updated_at
-- Table: member_wearable_connections

CREATE TRIGGER update_member_wearable_connections_updated_at
    BEFORE UPDATE ON public.member_wearable_connections
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

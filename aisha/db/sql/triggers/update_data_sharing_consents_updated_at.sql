-- Trigger: update_data_sharing_consents_updated_at
-- Table: data_sharing_consents

CREATE TRIGGER update_data_sharing_consents_updated_at
    BEFORE UPDATE ON public.data_sharing_consents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

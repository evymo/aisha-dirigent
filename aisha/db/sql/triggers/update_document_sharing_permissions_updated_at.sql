-- Trigger: update_document_sharing_permissions_updated_at
-- Table: document_sharing_permissions

CREATE TRIGGER update_document_sharing_permissions_updated_at
    BEFORE UPDATE ON public.document_sharing_permissions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

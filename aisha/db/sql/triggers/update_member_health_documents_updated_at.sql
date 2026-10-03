-- Trigger: update_member_health_documents_updated_at
-- Table: member_health_documents

CREATE TRIGGER update_member_health_documents_updated_at
    BEFORE UPDATE ON public.member_health_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

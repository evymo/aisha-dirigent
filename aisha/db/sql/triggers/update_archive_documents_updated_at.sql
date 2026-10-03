-- Trigger: update_archive_documents_updated_at
-- Table: archive_documents

CREATE TRIGGER update_archive_documents_updated_at
    BEFORE UPDATE ON public.archive_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Index: idx_archive_documents_parent_document_id
-- Table: archive_documents

CREATE INDEX IF NOT EXISTS idx_archive_documents_parent_document_id ON public.archive_documents(parent_document_id);

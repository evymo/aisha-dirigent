-- Index: idx_archive_documents_document_type
-- Table: archive_documents

CREATE INDEX idx_archive_documents_document_type ON public.archive_documents USING btree (document_type);

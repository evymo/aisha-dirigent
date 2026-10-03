-- Index: idx_archive_documents_keywords
-- Table: archive_documents

CREATE INDEX idx_archive_documents_keywords ON public.archive_documents USING gin (keywords);

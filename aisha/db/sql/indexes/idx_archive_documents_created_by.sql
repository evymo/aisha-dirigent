-- Index: idx_archive_documents_created_by
-- Table: archive_documents

CREATE INDEX IF NOT EXISTS idx_archive_documents_created_by ON public.archive_documents(created_by);

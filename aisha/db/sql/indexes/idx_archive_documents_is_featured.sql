-- Index: idx_archive_documents_is_featured
-- Table: archive_documents

CREATE INDEX idx_archive_documents_is_featured ON public.archive_documents USING btree (is_featured);

-- Index: idx_archive_documents_year
-- Table: archive_documents

CREATE INDEX idx_archive_documents_year ON public.archive_documents USING btree (year);

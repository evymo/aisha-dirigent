-- Index: idx_archive_documents_decade
-- Table: archive_documents

CREATE INDEX idx_archive_documents_decade ON public.archive_documents USING btree (decade);

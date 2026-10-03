-- Index: idx_products_archive_document_id
-- Table: products

CREATE INDEX idx_products_archive_document_id ON public.products USING btree (archive_document_id) WHERE (archive_document_id IS NOT NULL);

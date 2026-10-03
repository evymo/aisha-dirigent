-- Index: idx_product_label_archive_product_id
-- Table: product_label_archive

CREATE INDEX IF NOT EXISTS idx_product_label_archive_product_id ON public.product_label_archive(product_id);

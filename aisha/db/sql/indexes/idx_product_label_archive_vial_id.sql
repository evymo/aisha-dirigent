-- Index: idx_product_label_archive_vial_id
-- Table: product_label_archive

CREATE INDEX IF NOT EXISTS idx_product_label_archive_vial_id ON public.product_label_archive(vial_id);

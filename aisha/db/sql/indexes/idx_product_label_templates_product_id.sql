-- Index: idx_product_label_templates_product_id
-- Table: product_label_templates

CREATE INDEX IF NOT EXISTS idx_product_label_templates_product_id ON public.product_label_templates(product_id);

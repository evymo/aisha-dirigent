-- Index: products_sku_key
-- Table: products

CREATE UNIQUE INDEX products_sku_key ON public.products USING btree (sku);

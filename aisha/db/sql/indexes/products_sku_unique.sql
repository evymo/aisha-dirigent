-- Index: products_sku_unique
-- Table: products

CREATE UNIQUE INDEX products_sku_unique ON public.products USING btree (sku) WHERE (sku IS NOT NULL);

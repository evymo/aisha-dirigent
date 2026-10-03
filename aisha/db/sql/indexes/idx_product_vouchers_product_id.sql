-- Index: idx_product_vouchers_product_id
-- Table: product_vouchers

CREATE INDEX idx_product_vouchers_product_id ON public.product_vouchers USING btree (product_id);

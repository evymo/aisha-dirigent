-- Index: idx_product_vouchers_status
-- Table: product_vouchers

CREATE INDEX idx_product_vouchers_status ON public.product_vouchers USING btree (status);

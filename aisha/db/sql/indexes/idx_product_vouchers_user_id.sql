-- Index: idx_product_vouchers_user_id
-- Table: product_vouchers

CREATE INDEX idx_product_vouchers_user_id ON public.product_vouchers USING btree (user_id);

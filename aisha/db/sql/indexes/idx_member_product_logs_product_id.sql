-- Index: idx_member_product_logs_product_id
-- Table: member_product_logs

CREATE INDEX IF NOT EXISTS idx_member_product_logs_product_id ON public.member_product_logs(product_id);

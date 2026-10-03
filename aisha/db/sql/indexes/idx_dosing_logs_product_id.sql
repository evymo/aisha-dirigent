-- Index: idx_dosing_logs_product_id
-- Table: dosing_logs

CREATE INDEX IF NOT EXISTS idx_dosing_logs_product_id ON public.dosing_logs(product_id);

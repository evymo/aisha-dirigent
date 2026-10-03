-- Index: idx_lab_test_orders_processed_by
-- Table: lab_test_orders

CREATE INDEX IF NOT EXISTS idx_lab_test_orders_processed_by ON public.lab_test_orders(processed_by);

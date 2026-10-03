-- Index: idx_lab_test_orders_status
-- Table: lab_test_orders

CREATE INDEX IF NOT EXISTS idx_lab_test_orders_status 
  ON lab_test_orders (status, created_at DESC);

-- Story context index

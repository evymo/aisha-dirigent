-- Index: idx_lab_test_orders_user
-- Table: lab_test_orders

CREATE INDEX IF NOT EXISTS idx_lab_test_orders_user 
  ON lab_test_orders (user_id);

-- Status filter index

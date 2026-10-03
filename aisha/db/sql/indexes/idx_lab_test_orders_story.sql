-- Index: idx_lab_test_orders_story
-- Table: lab_test_orders

CREATE INDEX IF NOT EXISTS idx_lab_test_orders_story 
  ON lab_test_orders (story_id) 
  WHERE story_id IS NOT NULL;

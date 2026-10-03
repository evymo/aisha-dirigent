-- Table: lab_test_orders
-- Description: Lab test orders placed by members based on AI recommendations
-- Created: 2026-02-03

CREATE TABLE IF NOT EXISTS lab_test_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  
  -- Order status
  status text NOT NULL DEFAULT 'pending',
  
  -- Ordered tests (JSONB array)
  tests jsonb NOT NULL DEFAULT '[]'::jsonb,
  
  -- Context
  story_id uuid REFERENCES public.partner_stories ON DELETE SET NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  
  -- Financial
  total_price numeric(10,2) NOT NULL DEFAULT 0,
  currency text,
  
  -- Processing
  processed_at timestamptz,
  processed_by uuid,
  notes text,
  
  -- Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  PRIMARY KEY (id),
  CONSTRAINT lab_test_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT lab_test_orders_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT lab_test_orders_status_check CHECK (status IN ('pending', 'confirmed', 'processing', 'completed', 'cancelled'))
);

ALTER TABLE lab_test_orders ENABLE ROW LEVEL SECURITY;

-- Column documentation
COMMENT ON TABLE lab_test_orders IS 'Lab test orders from AI-powered recommendations';
COMMENT ON COLUMN lab_test_orders.tests IS 'Array of ordered tests: [{code, name, price, priority, reason}]';
COMMENT ON COLUMN lab_test_orders.story_id IS 'Optional reference to StoryLoop story context';
COMMENT ON COLUMN lab_test_orders.metadata IS 'Additional context: products, conditions, has_ai_recommendations';
COMMENT ON COLUMN lab_test_orders.total_price IS 'Sum of all test prices in CZK';
COMMENT ON COLUMN lab_test_orders.status IS 'Order status: pending, confirmed, processing, completed, cancelled';

-- Grants
GRANT SELECT, INSERT ON lab_test_orders TO authenticated;

-- Index: idx_member_product_plans_user_active
-- Table: member_product_plans

CREATE INDEX IF NOT EXISTS idx_member_product_plans_user_active
  ON member_product_plans(user_id, created_at DESC) WHERE is_active = true;

-- member_product_logs indexes

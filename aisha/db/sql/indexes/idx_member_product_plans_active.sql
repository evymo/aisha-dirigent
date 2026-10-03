-- Index: idx_member_product_plans_active
-- Table: member_product_plans

CREATE INDEX IF NOT EXISTS idx_member_product_plans_active ON member_product_plans(is_active) WHERE is_active = true;

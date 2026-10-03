-- Index: idx_member_products_created_by
-- Table: member_products

CREATE INDEX IF NOT EXISTS idx_member_products_created_by ON member_products(created_by);

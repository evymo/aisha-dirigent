-- Index: idx_member_products_is_public
-- Table: member_products

CREATE INDEX IF NOT EXISTS idx_member_products_is_public ON member_products(is_public) WHERE is_public = true;

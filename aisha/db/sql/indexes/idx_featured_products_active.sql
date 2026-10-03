-- Index: idx_featured_products_active
-- Table: featured_products

CREATE INDEX IF NOT EXISTS idx_featured_products_active 
  ON featured_products (is_active, display_location, sort_order);

-- FK lookup index

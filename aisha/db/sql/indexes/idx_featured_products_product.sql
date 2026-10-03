-- Index: idx_featured_products_product
-- Table: featured_products

CREATE INDEX IF NOT EXISTS idx_featured_products_product 
  ON featured_products (product_id);

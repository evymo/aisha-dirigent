-- Index: idx_order_items_product_id
-- Table: order_items

CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items(product_id);

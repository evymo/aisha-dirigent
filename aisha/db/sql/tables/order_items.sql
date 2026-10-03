-- Table: order_items
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS order_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity int4 NOT NULL DEFAULT 1,
  price numeric(10,2) ,
  price_at_purchase numeric(10,2),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id)
);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- Grants: user-owned order items
GRANT SELECT, INSERT ON order_items TO authenticated;
GRANT ALL ON order_items TO service_role;

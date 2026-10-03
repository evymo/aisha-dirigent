-- Table: cart_items
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS cart_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity int4 NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT cart_items_user_id_product_id_key UNIQUE (user_id, product_id),
  CONSTRAINT cart_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT cart_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;

-- Grants: user-owned cart data
GRANT SELECT, INSERT, UPDATE, DELETE ON cart_items TO authenticated;
GRANT ALL ON cart_items TO service_role;

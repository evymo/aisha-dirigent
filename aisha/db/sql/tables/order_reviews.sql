-- Table: order_reviews
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS order_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  user_id uuid NOT NULL,
  rating int4,
  title text,
  review text,
  comment text,
  is_verified_purchase bool DEFAULT false,
  is_featured bool DEFAULT false,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT order_reviews_order_id_user_id_key UNIQUE (order_id, user_id),
  CONSTRAINT order_reviews_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT order_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE order_reviews ENABLE ROW LEVEL SECURITY;

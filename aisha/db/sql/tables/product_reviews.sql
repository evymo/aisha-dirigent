-- Table: product_reviews
-- Source of truth (SQL): used for init generation
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS product_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  user_id uuid NOT NULL,
  rating int4 NOT NULL,
  title text,
  review text,
  comment text,
  is_verified_purchase bool DEFAULT false,
  is_featured bool DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT product_reviews_product_id_user_id_key UNIQUE (product_id, user_id),
  CONSTRAINT product_reviews_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT product_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE product_reviews ENABLE ROW LEVEL SECURITY;

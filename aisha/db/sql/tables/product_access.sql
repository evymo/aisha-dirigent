-- Table: product_access
-- Source of truth (SQL): used for init generation
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS product_access (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_id uuid NOT NULL,
  access_type text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  granted_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT product_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT product_access_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT product_access_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT product_access_user_id_product_id_key UNIQUE (user_id, product_id)
);

ALTER TABLE product_access ENABLE ROW LEVEL SECURITY;

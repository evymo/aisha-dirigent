-- Table: product_vouchers
-- Voucher records used for product discounts during checkout.

CREATE TABLE IF NOT EXISTS product_vouchers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  product_id uuid,
  user_id uuid,
  status text NOT NULL DEFAULT 'active',
  points_cost int4,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id),
  CONSTRAINT product_vouchers_code_key UNIQUE (code),
  CONSTRAINT product_vouchers_status_check CHECK (status IN ('active', 'used', 'expired')),
  CONSTRAINT product_vouchers_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT product_vouchers_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE SET NULL
);

ALTER TABLE product_vouchers ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON product_vouchers TO authenticated;
GRANT ALL ON product_vouchers TO service_role;

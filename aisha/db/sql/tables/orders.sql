-- Table: orders
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text DEFAULT 'pending'::text,
  total numeric(10,2) NOT NULL,
  subtotal numeric(10,2),
  tax numeric(10,2),
  shipping numeric(10,2),
  currency text,
  shipping_address jsonb,
  billing_address jsonb,
  payment_method text,
  payment_status text DEFAULT 'pending'::text,
  stripe_payment_intent_id text,
  notes text,
  delivered_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  stripe_session_id text,
  packeta_packet_id text,
  packeta_barcode text,
  packeta_branch_id int4,
  carrier_id int4,
  carrier_name text,
  shipping_method text DEFAULT 'packeta_pickup'::text,
  tracking_url text,
  shipped_at timestamptz,
  dispute_status text DEFAULT NULL,
  -- Bank transfer columns (added in payment system migration)
  variable_symbol text,
  bank_transfer_iban text,
  bank_transfer_bic text,
  bank_transfer_amount numeric(10,2),
  bank_transfer_due_date timestamptz,
  -- Invoice columns (added in payment system migration)
  invoice_number text,
  invoice_generated_at timestamptz,
  invoice_pdf_path text,
  PRIMARY KEY (id),
  CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Grants: user-owned order data
GRANT SELECT, INSERT ON orders TO authenticated;
GRANT ALL ON orders TO service_role;

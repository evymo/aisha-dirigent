-- Table: shipment_records
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS shipment_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  member_token uuid NOT NULL,
  distribution_month date NOT NULL,
  order_id uuid,
  packeta_packet_id text,
  packeta_barcode text,
  tracking_url text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  full_price numeric NOT NULL DEFAULT 0,
  discount_amount numeric DEFAULT 0,
  tokens_used int4 DEFAULT 0,
  shipping_cost numeric DEFAULT 0,
  final_price numeric,
  status text DEFAULT 'pending'::text,
  packed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  batch_allocations jsonb DEFAULT '[]'::jsonb,
  PRIMARY KEY (id),
  CONSTRAINT shipment_records_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);

ALTER TABLE shipment_records ENABLE ROW LEVEL SECURITY;

-- Table: product_vials
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS product_vials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  vial_number text ,
  status text DEFAULT 'available'::text,
  volume_ml numeric(10,2),
  expiry_date date,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  vial_code text,
  content_type text,
  assigned_study_id uuid,
  manufactured_at timestamptz,
  dispensed_at timestamptz,
  consumed_at timestamptz,
  qr_code_url text,
  updated_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT product_vials_vial_number_key UNIQUE (vial_number),
  CONSTRAINT product_vials_assigned_study_id_fkey FOREIGN KEY (assigned_study_id) REFERENCES studies(id),
  CONSTRAINT product_vials_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE CASCADE
);

ALTER TABLE product_vials ENABLE ROW LEVEL SECURITY;

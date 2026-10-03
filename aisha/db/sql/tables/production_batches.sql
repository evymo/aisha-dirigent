-- Table: production_batches
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_number text ,
  product_id uuid,
  status text DEFAULT 'planned'::text,
  quantity int4 ,
  started_at timestamptz,
  completed_at timestamptz,
  quality_approved bool,
  approved_by uuid,
  notes text,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  batch_code text,
  product_name text,
  purpose text,
  target_quantity int4,
  actual_quantity int4,
  total_units int4,
  available_units int4,
  unit text,
  study_id uuid,
  content_type text,
  production_date date,
  expiry_date date,
  released_at timestamptz,
  qc_approved_by uuid,
  qc_approved_at timestamptz,
  qc_notes text,
  raw_material_lot text,
  supplier_info text,
  blockchain_tx_hash text,
  blockchain_recorded_at timestamptz,
  created_by uuid,
  updated_at timestamptz,
  workflow_template_id uuid,
  projected_yield_percent numeric(8,4),
  -- Story per procesní běh (stack konvence: provozní tabulky nesou story_id).
  -- Plněno ensure_production_batch_story (origin=process, success_criteria=milníky).
  story_id uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_batches_batch_number_key UNIQUE (batch_number),
  CONSTRAINT production_batches_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT production_batches_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT production_batches_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id),
  CONSTRAINT production_batches_workflow_template_id_fkey FOREIGN KEY (workflow_template_id) REFERENCES production_workflow_templates(id),
  CONSTRAINT production_batches_story_id_fkey FOREIGN KEY (story_id) REFERENCES partner_stories(id)
);

ALTER TABLE production_batches ENABLE ROW LEVEL SECURITY;

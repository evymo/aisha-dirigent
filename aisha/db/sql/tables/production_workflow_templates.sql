-- Table: production_workflow_templates
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_workflow_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  product_type text,
  steps jsonb ,
  is_active bool DEFAULT true,
  created_at timestamptz DEFAULT now(),
  name_key text,
  description_key text,
  version text,
  workflow_data jsonb,
  is_default bool,
  created_by uuid,
  updated_at timestamptz,
  product_id uuid,
  workflow_steps jsonb,
  current_version_number integer DEFAULT 1,
  PRIMARY KEY (id),
  CONSTRAINT production_workflow_templates_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id)
);

ALTER TABLE production_workflow_templates ENABLE ROW LEVEL SECURITY;

-- Table: workflow_templates
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS workflow_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  template_type text,
  steps jsonb NOT NULL,
  is_active bool DEFAULT true,
  created_at timestamptz DEFAULT now(),
  product_id uuid,
  updated_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT workflow_templates_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id)
);

ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;

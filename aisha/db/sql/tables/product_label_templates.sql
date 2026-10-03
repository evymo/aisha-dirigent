-- Table: product_label_templates
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS product_label_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text ,
  product_type text,
  template_content jsonb ,
  is_active bool DEFAULT true,
  created_at timestamptz DEFAULT now(),
  product_id uuid,
  version text,
  version_date timestamptz,
  status text,
  product_name_key text DEFAULT '',
  description_key text DEFAULT '',
  composition_key text DEFAULT '',
  usage_instructions_key text DEFAULT '',
  warnings_key text DEFAULT '',
  storage_conditions_key text DEFAULT '',
  registration_number text,
  szpi_certificate text,
  bio_certification text,
  country_of_origin text,
  manufacturer text,
  manufacturer_address text,
  variants jsonb,
  label_design_url text,
  label_pdf_url text,
  change_log jsonb,
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid,
  updated_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT product_label_templates_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id)
);

ALTER TABLE product_label_templates ENABLE ROW LEVEL SECURITY;

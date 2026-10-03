-- Table: product_label_archive
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS product_label_archive (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vial_id uuid,
  batch_id uuid,
  label_data jsonb NOT NULL,
  generated_at timestamptz DEFAULT now(),
  template_id uuid,
  product_id uuid,
  version text,
  version_date timestamptz,
  archived_at timestamptz,
  archived_by uuid,
  archive_reason text,
  is_public bool DEFAULT false,
  pdf_url text,
  scan_url text,
  created_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT product_label_archive_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES production_batches(id),
  CONSTRAINT product_label_archive_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT product_label_archive_template_id_fkey FOREIGN KEY (template_id) REFERENCES product_label_templates(id),
  CONSTRAINT product_label_archive_vial_id_fkey FOREIGN KEY (vial_id) REFERENCES product_vials(id)
);

ALTER TABLE product_label_archive ENABLE ROW LEVEL SECURITY;

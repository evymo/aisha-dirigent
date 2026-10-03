-- Table: product_access_rules
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS product_access_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  required_role app_role,
  required_study_id uuid,
  required_registration_status text,
  min_certification_level int4,
  requires_informed_consent bool DEFAULT false,
  access_type product_access_type NOT NULL,
  priority int4 NOT NULL DEFAULT 0,
  is_active bool NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT product_access_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT product_access_rules_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT product_access_rules_required_study_id_fkey FOREIGN KEY (required_study_id) REFERENCES studies(id) ON DELETE CASCADE
);

ALTER TABLE product_access_rules ENABLE ROW LEVEL SECURITY;

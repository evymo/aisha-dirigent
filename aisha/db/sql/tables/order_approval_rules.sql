-- Table: order_approval_rules
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS order_approval_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  required_role app_role,
  required_study_id uuid,
  min_certification_level int4,
  max_order_value numeric(10,2),
  is_active bool NOT NULL DEFAULT true,
  priority int4 NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT order_approval_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT order_approval_rules_required_study_id_fkey FOREIGN KEY (required_study_id) REFERENCES studies(id) ON DELETE CASCADE
);

ALTER TABLE order_approval_rules ENABLE ROW LEVEL SECURITY;

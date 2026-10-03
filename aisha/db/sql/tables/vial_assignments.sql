-- Table: vial_assignments
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS vial_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vial_id uuid NOT NULL,
  user_id uuid ,
  study_id uuid,
  assigned_at timestamptz DEFAULT now(),
  assigned_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT vial_assignments_vial_id_key UNIQUE (vial_id),
  CONSTRAINT vial_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT vial_assignments_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id),
  CONSTRAINT vial_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT vial_assignments_vial_id_fkey FOREIGN KEY (vial_id) REFERENCES product_vials(id) ON DELETE CASCADE
);

ALTER TABLE vial_assignments ENABLE ROW LEVEL SECURITY;

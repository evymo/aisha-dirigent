-- Table: lab_results
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS lab_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  test_type text,
  test_date date NOT NULL,
  result_date date,
  results jsonb,
  file_url text,
  notes text,
  created_at timestamptz DEFAULT now(),
  study_registration_id uuid,
  document_id uuid,
  lab_name text,
  status lab_result_status DEFAULT 'pending'::lab_result_status,
  crp numeric,
  esr numeric,
  wbc numeric,
  rbc numeric,
  hemoglobin numeric,
  platelets numeric,
  glucose numeric,
  hba1c numeric,
  insulin numeric,
  cholesterol_total numeric,
  ldl numeric,
  hdl numeric,
  triglycerides numeric,
  alt numeric,
  ast numeric,
  creatinine numeric,
  urea numeric,
  vitamin_d numeric,
  vitamin_b12 numeric,
  nk_cells numeric,
  cd4_count numeric,
  cd8_count numeric,
  il_4 numeric,
  il_6 numeric,
  tnf_alpha numeric,
  nad_nadh_ratio numeric,
  omega3_index numeric,
  raw_data jsonb,
  reviewed_by uuid,
  reviewed_at timestamptz,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT lab_results_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT lab_results_study_registration_id_fkey FOREIGN KEY (study_registration_id) REFERENCES study_registrations(id),
  CONSTRAINT lab_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT lab_results_document_id_fkey FOREIGN KEY (document_id) REFERENCES member_health_documents(id) ON DELETE SET NULL
);

ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY;

-- Grants: user-owned sensitive data table
GRANT SELECT, INSERT, UPDATE ON lab_results TO authenticated;
GRANT ALL ON lab_results TO service_role;

-- Table: study_test_templates
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS study_test_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL,
  template_id uuid NOT NULL,
  is_required bool DEFAULT true,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT study_test_templates_study_id_template_id_key UNIQUE (template_id, study_id),
  CONSTRAINT study_test_templates_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE,
  CONSTRAINT study_test_templates_template_id_fkey FOREIGN KEY (template_id) REFERENCES test_templates(id) ON DELETE CASCADE
);

ALTER TABLE study_test_templates ENABLE ROW LEVEL SECURITY;

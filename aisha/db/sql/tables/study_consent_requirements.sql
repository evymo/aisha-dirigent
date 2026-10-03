-- Table: study_consent_requirements
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS study_consent_requirements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL,
  consent_template_id uuid NOT NULL,
  is_required bool NOT NULL DEFAULT true,
  sort_order int4 NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_active bool NOT NULL DEFAULT true,
  consent_template_version text NOT NULL DEFAULT '1.0'::text,
  display_order int4 NOT NULL DEFAULT 0,
  valid_from timestamptz,
  valid_until timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT study_consent_requirements_study_id_consent_template_id_key UNIQUE (study_id, consent_template_id),
  CONSTRAINT study_consent_requirements_consent_template_id_fkey FOREIGN KEY (consent_template_id) REFERENCES consent_templates(id) ON DELETE CASCADE,
  CONSTRAINT study_consent_requirements_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE
);

ALTER TABLE study_consent_requirements ENABLE ROW LEVEL SECURITY;

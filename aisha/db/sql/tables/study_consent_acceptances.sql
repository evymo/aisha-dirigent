-- Table: study_consent_acceptances
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS study_consent_acceptances (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  study_id uuid NOT NULL,
  consent_template_id uuid NOT NULL,
  consent_template_version int4 NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  signature_data text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT study_consent_acceptances_user_id_study_id_consent_template_key UNIQUE (study_id, consent_template_id, consent_template_version, user_id),
  CONSTRAINT study_consent_acceptances_consent_template_id_fkey FOREIGN KEY (consent_template_id) REFERENCES consent_templates(id) ON DELETE CASCADE,
  CONSTRAINT study_consent_acceptances_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE,
  CONSTRAINT study_consent_acceptances_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE study_consent_acceptances ENABLE ROW LEVEL SECURITY;

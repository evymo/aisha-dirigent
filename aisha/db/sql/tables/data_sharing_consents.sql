-- Table: data_sharing_consents
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS data_sharing_consents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  partner_id uuid NOT NULL,
  study_id uuid,
  consent_type text,
  scope text[] DEFAULT '{}'::text[],
  consent_requested_at timestamptz,
  granted_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT data_sharing_consents_user_id_partner_id_consent_type_key UNIQUE (partner_id, user_id, consent_type),
  CONSTRAINT data_sharing_consents_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES partner_profiles(id) ON DELETE CASCADE,
  CONSTRAINT data_sharing_consents_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE SET NULL,
  CONSTRAINT data_sharing_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE data_sharing_consents ENABLE ROW LEVEL SECURITY;

-- Grants: user-owned consent data
GRANT SELECT, INSERT, UPDATE ON data_sharing_consents TO authenticated;
GRANT ALL ON data_sharing_consents TO service_role;

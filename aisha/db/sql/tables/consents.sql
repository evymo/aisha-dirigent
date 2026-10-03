-- Table: consents
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS consents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  consent_type consent_type NOT NULL,
  version text DEFAULT '1.0'::text,
  granted bool NOT NULL,
  granted_at timestamptz,
  revoked_at timestamptz,
  ip_address text,
  user_agent text,
  created_at timestamptz DEFAULT now(),
  study_id uuid,
  document_url text,
  signature_data text,
  PRIMARY KEY (id),
  CONSTRAINT consents_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE SET NULL,
  CONSTRAINT consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

-- Note: Unique indexes are defined in supabase/sql/indexes/consents_unique_indexes.sql

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;

-- Grants: user-owned consent data
GRANT SELECT, INSERT, UPDATE ON consents TO authenticated;
GRANT ALL ON consents TO service_role;

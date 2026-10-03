-- Table: production_credentials
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_credentials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  credential_type text NOT NULL,
  license_number text,
  issuing_authority text,
  country_code text,
  verified_at timestamptz,
  verified_by uuid,
  expires_at timestamptz,
  is_active bool NOT NULL DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT production_credentials_user_id_credential_type_license_numb_key UNIQUE (license_number, credential_type, user_id),
  CONSTRAINT production_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT production_credentials_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_credentials ENABLE ROW LEVEL SECURITY;

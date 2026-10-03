-- Table: partner_matching_profiles
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS partner_matching_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  preferences jsonb,
  health_goals text[],
  preferred_partner_type text,
  location text,
  max_distance_km int4,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT partner_matching_profiles_user_id_key UNIQUE (user_id),
  CONSTRAINT partner_matching_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE partner_matching_profiles ENABLE ROW LEVEL SECURITY;

-- Table: profiles
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text,
  display_name text,
  first_name text,
  last_name text,
  avatar_url text,
  phone text,
  date_of_birth date,
  gender text,
  address jsonb,
  emergency_contact jsonb,
  primary_diagnosis text,
  medical_history text,
  current_medications text,
  allergies text,
  wearable_device_type text,
  wearable_device_id text,
  preferred_language text DEFAULT 'en'::text,
  preferred_currency text,
  has_password bool DEFAULT false,
  password_set_at timestamptz,
  must_change_password bool DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  stripe_customer_id text,
  nickname text,
  is_public_profile bool NOT NULL DEFAULT false,
  show_in_leaderboard bool NOT NULL DEFAULT false,
  cosmos_address text,
  PRIMARY KEY (id),
  CONSTRAINT profiles_user_id_key UNIQUE (user_id),
  CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Grants: user-owned profile table
GRANT SELECT, INSERT, UPDATE ON profiles TO authenticated;
GRANT ALL ON profiles TO service_role;

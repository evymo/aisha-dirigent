-- Table: partner_profiles
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS partner_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  display_name text NOT NULL,
  email text,
  phone text,
  avatar_url text,
  business_name text,
  description text,
  website text,
  address text,
  city text NOT NULL,
  country text DEFAULT 'CZ'::text,
  certification_level partner_certification_level DEFAULT 'certified_partner'::partner_certification_level,
  certification_passed_at timestamptz,
  certification_score numeric,
  is_production_provider bool DEFAULT false,
  services text[],
  languages text[],
  accepts_online_appointments bool DEFAULT false,
  accepts_in_person_appointments bool DEFAULT true,
  notes_for_visitors text,
  is_visible bool DEFAULT true,
  is_certified bool DEFAULT false,
  is_accepting_clients bool DEFAULT true,
  access_level text DEFAULT 'standard'::text,
  specialization text,
  guild_tier guild_tier DEFAULT 'apprentice',
  guild_joined_at timestamptz,
  guild_bio text,
  expertise_summary text,
  avg_rating numeric DEFAULT 0,
  total_ratings_count integer NOT NULL DEFAULT 0,
  completed_projects_count integer NOT NULL DEFAULT 0,
  active_projects_count integer NOT NULL DEFAULT 0,
  avg_response_time_hours numeric(5,1),
  acceptance_rate numeric(5,2) DEFAULT 100.00,
  stripe_connect_account_id text,
  stripe_connect_status text DEFAULT 'not_connected',
  last_active_at timestamptz DEFAULT now(),
  slot_duration_minutes integer NOT NULL DEFAULT 30,
  buffer_minutes integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT partner_profiles_user_id_key UNIQUE (user_id),
  CONSTRAINT partner_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE partner_profiles ENABLE ROW LEVEL SECURITY;

-- Grants: public partner directory + partner self-management
GRANT SELECT ON partner_profiles TO anon;
GRANT SELECT, INSERT, UPDATE ON partner_profiles TO authenticated;
GRANT ALL ON partner_profiles TO service_role;

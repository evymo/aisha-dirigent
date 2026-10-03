-- Table: health_check_ins
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS health_check_ins (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  study_id uuid,
  check_in_date date NOT NULL DEFAULT CURRENT_DATE,
  pain_level int4,
  energy_level int4,
  mood_level int4,
  sleep_quality int4,
  sleep_hours numeric(3,1),
  notes text,
  symptoms jsonb,
  medications jsonb,
  created_at timestamptz DEFAULT now(),
  study_registration_id uuid,
  data_source text DEFAULT 'manual'::text,
  device_info text,
  sync_batch_id uuid,
  synced_at timestamptz,
  heart_rate_avg int4,
  heart_rate_min int4,
  heart_rate_max int4,
  steps_count int4,
  active_energy_burned int4,
  distance_meters int4,
  activity_minutes int4,
  client_synced_at timestamptz,
  sync_status text DEFAULT 'synced'::text,
  check_in_type check_in_type,
  pain_location text,
  pain_notes text,
  exercise_type text,
  womac_pain int4,
  womac_stiffness int4,
  womac_function int4,
  took_medication bool DEFAULT false,
  medication_notes text,
  side_effects text,
  general_notes text,
  PRIMARY KEY (id),
  CONSTRAINT health_check_ins_study_registration_id_fkey FOREIGN KEY (study_registration_id) REFERENCES study_registrations(id),
  CONSTRAINT health_check_ins_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE SET NULL,
  CONSTRAINT health_check_ins_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE health_check_ins ENABLE ROW LEVEL SECURITY;

-- Grants: user-owned sensitive data table
GRANT SELECT, INSERT, UPDATE, DELETE ON health_check_ins TO authenticated;
GRANT ALL ON health_check_ins TO service_role;

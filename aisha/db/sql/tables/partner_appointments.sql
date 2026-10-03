-- Table: partner_appointments
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS partner_appointments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL,
  member_id uuid NOT NULL,
  study_id uuid,
  scheduled_at timestamptz,
  duration_minutes int4 DEFAULT 30,
  status text DEFAULT 'scheduled'::text,
  type text DEFAULT 'consultation'::text,
  notes text,
  cancellation_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  appointment_date date,
  start_time time,
  end_time time,
  appointment_type text,
  service text,
  PRIMARY KEY (id),
  CONSTRAINT partner_appointments_member_id_fkey FOREIGN KEY (member_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT partner_appointments_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES partner_profiles(id) ON DELETE CASCADE,
  CONSTRAINT partner_appointments_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE SET NULL
);

ALTER TABLE partner_appointments ENABLE ROW LEVEL SECURITY;

-- Grants: user and partner owned appointments
GRANT SELECT, INSERT, UPDATE ON partner_appointments TO authenticated;
GRANT ALL ON partner_appointments TO service_role;

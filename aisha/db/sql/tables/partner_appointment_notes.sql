-- Table: partner_appointment_notes
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS partner_appointment_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL,
  author_id uuid NOT NULL,
  content text NOT NULL,
  is_private bool DEFAULT false,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT partner_appointment_notes_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES partner_appointments(id) ON DELETE CASCADE,
  CONSTRAINT partner_appointment_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE partner_appointment_notes ENABLE ROW LEVEL SECURITY;

-- Grants: user and partner owned appointment notes
GRANT SELECT, INSERT, UPDATE ON partner_appointment_notes TO authenticated;
GRANT ALL ON partner_appointment_notes TO service_role;

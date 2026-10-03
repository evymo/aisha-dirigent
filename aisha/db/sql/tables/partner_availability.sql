-- Table: partner_availability
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS partner_availability (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL,
  day_of_week int4,
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_available bool DEFAULT true,
  created_at timestamptz DEFAULT now(),
  is_online bool DEFAULT false,
  PRIMARY KEY (id),
  CONSTRAINT partner_availability_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES partner_profiles(id) ON DELETE CASCADE
);

ALTER TABLE partner_availability ENABLE ROW LEVEL SECURITY;

-- Grants: public availability + partner self-management
GRANT SELECT ON partner_availability TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON partner_availability TO authenticated;
GRANT ALL ON partner_availability TO service_role;

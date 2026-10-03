-- Table: partner_appointment_reviews
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS partner_appointment_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL,
  reviewer_id uuid,
  rating int4,
  review text,
  created_at timestamptz DEFAULT now(),
  member_id uuid,
  partner_id uuid,
  comment text,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT partner_appointment_reviews_appointment_id_reviewer_id_key UNIQUE (appointment_id, reviewer_id),
  CONSTRAINT partner_appointment_reviews_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES partner_appointments(id) ON DELETE CASCADE,
  CONSTRAINT partner_appointment_reviews_member_id_fkey FOREIGN KEY (member_id) REFERENCES aisha_auth.users(id),
  CONSTRAINT partner_appointment_reviews_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES partner_profiles(id),
  CONSTRAINT partner_appointment_reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE partner_appointment_reviews ENABLE ROW LEVEL SECURITY;

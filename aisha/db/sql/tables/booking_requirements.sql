-- Table: booking_requirements
-- Requirements/description for a consultation booking (1:1 with consultation_bookings).
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS booking_requirements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  description text NOT NULL,
  tags text[],
  preferred_communication text NOT NULL DEFAULT 'written',
  urgency text NOT NULL DEFAULT 'normal',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT booking_requirements_booking_id_key UNIQUE (booking_id),
  CONSTRAINT booking_requirements_booking_id_fkey FOREIGN KEY (booking_id)
    REFERENCES consultation_bookings(id) ON DELETE CASCADE,
  CONSTRAINT booking_requirements_communication_check
    CHECK (preferred_communication IN ('written', 'video', 'mixed')),
  CONSTRAINT booking_requirements_urgency_check
    CHECK (urgency IN ('normal', 'urgent', 'asap'))
);

ALTER TABLE booking_requirements ENABLE ROW LEVEL SECURITY;


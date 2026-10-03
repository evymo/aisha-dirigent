-- Table: consultation_bookings
-- Specialist consultation booking records with payment and status tracking.
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS consultation_bookings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL,
  specialist_id uuid NOT NULL,
  story_id uuid,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  duration_hours numeric(4,1) NOT NULL DEFAULT 4,
  price numeric(10,2) NOT NULL,
  currency text,
  status booking_status NOT NULL DEFAULT 'pending_payment',
  payment_intent_id text,
  payment_status text,
  specialist_accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  escrow_released_at timestamptz,
  cancellation_reason text,
  cancelled_by uuid,
  cancelled_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT consultation_bookings_member_id_fkey FOREIGN KEY (member_id)
    REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT consultation_bookings_specialist_id_fkey FOREIGN KEY (specialist_id)
    REFERENCES partner_profiles(id) ON DELETE CASCADE,
  CONSTRAINT consultation_bookings_story_id_fkey FOREIGN KEY (story_id)
    REFERENCES partner_stories(id) ON DELETE SET NULL,
  CONSTRAINT consultation_bookings_cancelled_by_fkey FOREIGN KEY (cancelled_by)
    REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT consultation_bookings_price_positive CHECK (price > 0),
  CONSTRAINT consultation_bookings_duration_positive CHECK (duration_hours > 0)
);

ALTER TABLE consultation_bookings ENABLE ROW LEVEL SECURITY;


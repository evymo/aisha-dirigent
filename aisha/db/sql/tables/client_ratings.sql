-- Table: client_ratings
-- Specialist ratings for clients (mutual rating system).
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS client_ratings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  rater_specialist_id uuid NOT NULL,
  rated_client_id uuid NOT NULL,
  overall_rating integer NOT NULL,
  cooperation_rating integer,
  clarity_rating integer,
  review_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT client_ratings_booking_id_key UNIQUE (booking_id),
  CONSTRAINT client_ratings_booking_id_fkey FOREIGN KEY (booking_id)
    REFERENCES consultation_bookings(id) ON DELETE CASCADE,
  CONSTRAINT client_ratings_specialist_id_fkey FOREIGN KEY (rater_specialist_id)
    REFERENCES partner_profiles(id) ON DELETE CASCADE,
  CONSTRAINT client_ratings_client_id_fkey FOREIGN KEY (rated_client_id)
    REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT client_ratings_overall_range CHECK (overall_rating >= 1 AND overall_rating <= 5),
  CONSTRAINT client_ratings_cooperation_range
    CHECK (cooperation_rating IS NULL OR (cooperation_rating >= 1 AND cooperation_rating <= 5)),
  CONSTRAINT client_ratings_clarity_range
    CHECK (clarity_rating IS NULL OR (clarity_rating >= 1 AND clarity_rating <= 5))
);

ALTER TABLE client_ratings ENABLE ROW LEVEL SECURITY;


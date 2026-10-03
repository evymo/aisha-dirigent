-- Table: specialist_ratings
-- Client ratings for specialists after completed bookings.
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS specialist_ratings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  story_id uuid,
  rater_id uuid NOT NULL,
  rated_specialist_id uuid NOT NULL,
  overall_rating integer NOT NULL,
  communication_rating integer,
  expertise_rating integer,
  value_rating integer,
  review_text text,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT specialist_ratings_booking_id_key UNIQUE (booking_id),
  CONSTRAINT specialist_ratings_booking_id_fkey FOREIGN KEY (booking_id)
    REFERENCES consultation_bookings(id) ON DELETE CASCADE,
  CONSTRAINT specialist_ratings_story_id_fkey FOREIGN KEY (story_id)
    REFERENCES partner_stories(id) ON DELETE SET NULL,
  CONSTRAINT specialist_ratings_rater_id_fkey FOREIGN KEY (rater_id)
    REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT specialist_ratings_specialist_id_fkey FOREIGN KEY (rated_specialist_id)
    REFERENCES partner_profiles(id) ON DELETE CASCADE,
  CONSTRAINT specialist_ratings_overall_range CHECK (overall_rating >= 1 AND overall_rating <= 5),
  CONSTRAINT specialist_ratings_communication_range
    CHECK (communication_rating IS NULL OR (communication_rating >= 1 AND communication_rating <= 5)),
  CONSTRAINT specialist_ratings_expertise_range
    CHECK (expertise_rating IS NULL OR (expertise_rating >= 1 AND expertise_rating <= 5)),
  CONSTRAINT specialist_ratings_value_range
    CHECK (value_rating IS NULL OR (value_rating >= 1 AND value_rating <= 5))
);

ALTER TABLE specialist_ratings ENABLE ROW LEVEL SECURITY;


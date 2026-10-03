-- Table: study_ratings
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS study_ratings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL,
  user_id uuid NOT NULL,
  rating int4 NOT NULL,
  review text,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_visible bool NOT NULL DEFAULT true,
  registration_id uuid,
  comment text,
  PRIMARY KEY (id),
  CONSTRAINT study_ratings_study_id_user_id_key UNIQUE (study_id, user_id),
  CONSTRAINT study_ratings_registration_id_fkey FOREIGN KEY (registration_id) REFERENCES study_registrations(id) ON DELETE SET NULL,
  CONSTRAINT study_ratings_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE,
  CONSTRAINT study_ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE study_ratings ENABLE ROW LEVEL SECURITY;

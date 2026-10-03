-- Table: partner_reviews
-- Source of truth (SQL): used for init generation
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS partner_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL,
  user_id uuid NOT NULL,
  rating int4 NOT NULL,
  title text,
  review text,
  is_verified_client bool NOT NULL DEFAULT false,
  is_featured bool NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT partner_reviews_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES partner_profiles(id) ON DELETE CASCADE,
  CONSTRAINT partner_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT partner_reviews_partner_id_user_id_key UNIQUE (partner_id, user_id)
);

ALTER TABLE partner_reviews ENABLE ROW LEVEL SECURITY;

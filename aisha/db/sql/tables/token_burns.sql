-- Table: token_burns
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS token_burns (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  source_user_id uuid,
  burned_by uuid,
  amount numeric(20,8) NOT NULL,
  token_type text DEFAULT 'aisha'::text,
  burn_type text,
  burn_reason text,
  description text,
  burned_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT token_burns_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE SET NULL
);

ALTER TABLE token_burns ENABLE ROW LEVEL SECURITY;

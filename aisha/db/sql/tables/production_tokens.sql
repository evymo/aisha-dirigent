-- Table: production_tokens
-- Source of truth (SQL): used for init generation
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token_count int4 NOT NULL,
  expires_at timestamptz,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT production_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT production_tokens_token_count_check CHECK (token_count > 0)
);

ALTER TABLE production_tokens ENABLE ROW LEVEL SECURITY;

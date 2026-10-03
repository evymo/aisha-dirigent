-- Table: user_sessions
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id text ,
  ip_address text,
  user_agent text,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  session_token_hash text,
  last_activity timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- Grants: user-owned session data
GRANT SELECT, INSERT, UPDATE, DELETE ON user_sessions TO authenticated;
GRANT ALL ON user_sessions TO service_role;

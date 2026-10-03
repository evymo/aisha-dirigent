-- Table: mobile_sessions
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS mobile_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_platform text NOT NULL,
  device_model text,
  device_os_version text,
  app_version text NOT NULL,
  fcm_token text,
  apns_token text,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  device_id text NOT NULL,
  session_fingerprint text,
  PRIMARY KEY (id),
  CONSTRAINT mobile_sessions_user_device_unique UNIQUE (device_id, user_id),
  CONSTRAINT mobile_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE mobile_sessions ENABLE ROW LEVEL SECURITY;

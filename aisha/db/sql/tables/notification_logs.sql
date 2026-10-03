-- Table: notification_logs
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS notification_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  notification_type text NOT NULL,
  recipients_count int4 DEFAULT 0,
  devices_sent int4 DEFAULT 0,
  devices_failed int4 DEFAULT 0,
  title text,
  data jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

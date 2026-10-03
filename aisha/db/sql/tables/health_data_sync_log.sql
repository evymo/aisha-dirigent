-- Table: health_data_sync_log
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS health_data_sync_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  sync_batch_id uuid NOT NULL,
  records_count int4 NOT NULL,
  data_source text NOT NULL,
  device_info text,
  inserted_count int4 NOT NULL DEFAULT 0,
  skipped_count int4 NOT NULL DEFAULT 0,
  error_count int4 NOT NULL DEFAULT 0,
  sync_started_at timestamptz NOT NULL,
  sync_completed_at timestamptz,
  duration_ms int4,
  error_message text,
  error_details jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT health_data_sync_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE health_data_sync_log ENABLE ROW LEVEL SECURITY;

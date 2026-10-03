-- Table: wearable_analysis_files
-- Purpose: Stores file references for wearable analysis outputs (no raw sensitive data payloads here)
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS wearable_analysis_files (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  sync_batch_id uuid NOT NULL,
  data_source text NOT NULL,
  analysis_kind text NOT NULL DEFAULT 'daily_summary',
  file_bucket text NOT NULL DEFAULT 'wearable-analysis',
  file_path text NOT NULL,
  file_name text NOT NULL,
  checksum_sha256 text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT wearable_analysis_files_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT wearable_analysis_files_sync_path_unique UNIQUE (sync_batch_id, file_path)
);

ALTER TABLE wearable_analysis_files ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON wearable_analysis_files TO authenticated;
GRANT ALL ON wearable_analysis_files TO service_role;

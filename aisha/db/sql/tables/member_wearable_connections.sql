-- Table: member_wearable_connections
-- Purpose: Tracks connected wearable devices per member (multi-device support)
-- RLS: ENABLED - user can only manage their own device connections

CREATE TABLE IF NOT EXISTS member_wearable_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_type text NOT NULL,            -- 'apple_watch', 'fitbit', 'garmin', 'oura', 'healthkit', 'health_connect', etc.
  device_name text,                      -- User-friendly name: "Apple Watch Series 9"
  device_model text,                     -- Technical model: "Watch6,9"
  platform text NOT NULL DEFAULT 'ios',  -- 'ios' or 'android'
  connection_status text NOT NULL DEFAULT 'connected',  -- 'connected', 'disconnected', 'paused'
  permissions_granted text[] DEFAULT '{}', -- Array of granted permission types
  last_sync_at timestamptz,
  last_sync_batch_id uuid,
  sync_count int4 NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,  -- Device-specific metadata (firmware version, capabilities)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT member_wearable_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT member_wearable_connections_valid_status CHECK (connection_status IN ('connected', 'disconnected', 'paused')),
  CONSTRAINT member_wearable_connections_valid_platform CHECK (platform IN ('ios', 'android')),
  CONSTRAINT member_wearable_connections_unique_active UNIQUE (user_id, device_type, platform)
);

ALTER TABLE member_wearable_connections ENABLE ROW LEVEL SECURITY;

-- Indexes: see supabase/sql/indexes/member_wearable_connections.sql
-- Trigger: see supabase/sql/triggers/member_wearable_connections.sql

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON member_wearable_connections TO authenticated;
GRANT ALL ON member_wearable_connections TO service_role;

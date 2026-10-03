-- Enum: sync_flow_direction
-- Purpose: Direction of sync flow between managed and instance environments.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_flow_direction') THEN
    CREATE TYPE public.sync_flow_direction AS ENUM (
      'downstream_only',
      'promote_on_approval',
      'local_only',
      'no_sync'
    );
  END IF;
END $$;

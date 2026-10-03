-- Enum: plugin_status
-- Purpose: Lifecycle stage of a plugin in the plugin control plane.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plugin_status') THEN
    CREATE TYPE public.plugin_status AS ENUM (
      'submitted',
      'reviewing',
      'sandbox_testing',
      'approved',
      'canary',
      'ga',
      'disabled',
      'archived'
    );
  END IF;
END $$;

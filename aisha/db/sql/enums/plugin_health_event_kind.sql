-- Enum: plugin_health_event_kind
-- Purpose: Kind of plugin health/lifecycle event recorded in plugin_health_events.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plugin_health_event_kind') THEN
    CREATE TYPE public.plugin_health_event_kind AS ENUM (
      'load',
      'invoke',
      'error',
      'timeout',
      'rollback',
      'patch'
    );
  END IF;
END $$;

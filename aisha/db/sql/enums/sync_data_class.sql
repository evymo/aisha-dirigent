-- Enum: sync_data_class
-- Purpose: Classifies sync payload data per story sync infrastructure.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_data_class') THEN
    CREATE TYPE public.sync_data_class AS ENUM (
      'canonical_portable',
      'derived_reproducible',
      'sovereign_local'
    );
  END IF;
END $$;

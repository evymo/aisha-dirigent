-- Enum: aitg_severity
-- Purpose: Severity classification for AITG findings and runs.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aitg_severity') THEN
    CREATE TYPE public.aitg_severity AS ENUM (
      'info',
      'low',
      'medium',
      'high',
      'critical'
    );
  END IF;
END $$;

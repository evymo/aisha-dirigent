-- Enum: aitg_status
-- Purpose: Outcome of an AITG test run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aitg_status') THEN
    CREATE TYPE public.aitg_status AS ENUM (
      'passed',
      'failed',
      'flaky',
      'blocked',
      'waived',
      'not_applicable'
    );
  END IF;
END $$;

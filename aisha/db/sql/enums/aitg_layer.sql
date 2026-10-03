-- Enum: aitg_layer
-- Purpose: AITG (AI Test Generation) coverage layer — which substrate a test exercises.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aitg_layer') THEN
    CREATE TYPE public.aitg_layer AS ENUM (
      'app',
      'mod',
      'inf',
      'dat'
    );
  END IF;
END $$;

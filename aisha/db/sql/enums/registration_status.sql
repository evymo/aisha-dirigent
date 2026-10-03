-- Enum: registration_status
-- Purpose: Canonical study registration status values used across RPCs and admin UI.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'registration_status') THEN
    CREATE TYPE public.registration_status AS ENUM (
      'pending',
      'screening',
      'enrolled',
      'active',
      'completed',
      'withdrawn'
    );
  END IF;
END $$;

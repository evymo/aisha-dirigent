-- Enum: consultant_status_enum

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consultant_status_enum') THEN
    CREATE TYPE consultant_status_enum AS ENUM (
      'pending',
  'approved',
  'rejected',
  'completed'
    );
  END IF;
END $$;

-- Values: pending, approved, rejected, completed

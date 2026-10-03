-- Enum: contribution_status_enum

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contribution_status_enum') THEN
    CREATE TYPE contribution_status_enum AS ENUM (
      'pending',
  'completed',
  'refunded'
    );
  END IF;
END $$;

-- Values: pending, completed, refunded

-- Enum: check_in_type

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'check_in_type') THEN
    CREATE TYPE check_in_type AS ENUM (
      'morning',
  'evening',
  'weekly',
  'monthly'
    );
  END IF;
END $$;

-- Values: morning, evening, weekly, monthly

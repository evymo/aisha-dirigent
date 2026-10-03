-- Enum: payment_type

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_type') THEN
    CREATE TYPE payment_type AS ENUM (
      'one_time',
  'recurring'
    );
  END IF;
END $$;

-- Values: one_time, recurring

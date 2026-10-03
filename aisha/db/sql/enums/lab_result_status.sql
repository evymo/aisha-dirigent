-- Enum: lab_result_status

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lab_result_status') THEN
    CREATE TYPE lab_result_status AS ENUM (
      'pending',
  'completed',
  'reviewed'
    );
  END IF;
END $$;

-- Values: pending, completed, reviewed

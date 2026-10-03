-- Enum: assessment_status

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assessment_status') THEN
    CREATE TYPE assessment_status AS ENUM (
      'in_progress',
  'completed',
  'abandoned'
    );
  END IF;
END $$;

-- Values: in_progress, completed, abandoned

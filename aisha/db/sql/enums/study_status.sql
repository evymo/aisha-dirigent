-- Enum: study_status

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'study_status') THEN
    CREATE TYPE study_status AS ENUM (
      'screening',
  'enrolled',
  'active',
  'completed',
  'withdrawn'
    );
  END IF;
END $$;

-- Values: screening, enrolled, active, completed, withdrawn

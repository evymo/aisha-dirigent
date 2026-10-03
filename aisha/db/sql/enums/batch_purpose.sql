-- Enum: batch_purpose

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'batch_purpose') THEN
    CREATE TYPE batch_purpose AS ENUM (
      'study',
  'retail',
  'sample',
  'internal_testing'
    );
  END IF;
END $$;

-- Values: study, retail, sample, internal_testing

-- Enum: document_processing_status

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_processing_status') THEN
    CREATE TYPE document_processing_status AS ENUM (
      'pending',
  'processing',
  'completed',
  'failed'
    );
  END IF;
END $$;

-- Values: pending, processing, completed, failed

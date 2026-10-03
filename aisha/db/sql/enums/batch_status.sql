-- Enum: batch_status

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'batch_status') THEN
    CREATE TYPE batch_status AS ENUM (
      'draft',
  'in_production',
  'qc_pending',
  'qc_passed',
  'qc_failed',
  'released',
  'quarantined',
  'recalled',
  'expired'
    );
  END IF;
END $$;

-- Values: draft, in_production, qc_pending, qc_passed, qc_failed, released, quarantined, recalled, expired

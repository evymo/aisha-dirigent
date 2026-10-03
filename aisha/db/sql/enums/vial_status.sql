-- Enum: vial_status

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vial_status') THEN
    CREATE TYPE vial_status AS ENUM (
      'manufactured',
  'qc_passed',
  'allocated',
  'dispensed',
  'consumed',
  'returned',
  'destroyed',
  'lost'
    );
  END IF;
END $$;

-- Values: manufactured, qc_passed, allocated, dispensed, consumed, returned, destroyed, lost

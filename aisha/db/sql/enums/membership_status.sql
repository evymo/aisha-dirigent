-- Enum: membership_status

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_status') THEN
    CREATE TYPE membership_status AS ENUM (
      'active',
  'expired',
  'cancelled',
  'pending',
  'trial'
    );
  END IF;
END $$;

-- Values: active, expired, cancelled, pending, trial

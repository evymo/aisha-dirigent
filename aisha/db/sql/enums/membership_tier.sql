-- Enum: membership_tier

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_tier') THEN
    CREATE TYPE membership_tier AS ENUM (
      'basic',
  'upgraded',
  'trial'
    );
  END IF;
END $$;

-- Values: basic, upgraded, trial

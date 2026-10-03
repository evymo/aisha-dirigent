-- Enum: subscription_period

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_period') THEN
    CREATE TYPE subscription_period AS ENUM (
      'monthly',
  'quarterly',
  'annual'
    );
  END IF;
END $$;

-- Values: monthly, quarterly, annual

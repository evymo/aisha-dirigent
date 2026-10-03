-- Type: payout_status
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payout_status') THEN
    CREATE TYPE payout_status AS ENUM (
      'pending', 'processing', 'paid', 'failed'
    );
  END IF;
END $$;

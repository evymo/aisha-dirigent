-- Type: revenue_status
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'revenue_status') THEN
    CREATE TYPE revenue_status AS ENUM (
      'pending', 'calculated', 'approved', 'paid_out', 'disputed'
    );
  END IF;
END $$;

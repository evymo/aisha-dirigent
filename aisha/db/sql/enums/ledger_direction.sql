-- Type: ledger_direction
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_direction') THEN
    CREATE TYPE ledger_direction AS ENUM (
      'credit', 'debit'
    );
  END IF;
END $$;

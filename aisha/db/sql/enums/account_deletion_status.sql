-- Account Deletion Status Enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_deletion_status') THEN
    CREATE TYPE account_deletion_status AS ENUM ('pending', 'cancelled', 'completed');
  END IF;
END $$;

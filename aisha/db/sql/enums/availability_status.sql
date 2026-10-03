-- Type: availability_status
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'availability_status') THEN
    CREATE TYPE availability_status AS ENUM (
      'available', 'busy', 'away', 'offline'
    );
  END IF;
END $$;

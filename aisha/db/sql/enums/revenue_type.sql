-- Type: revenue_type
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'revenue_type') THEN
    CREATE TYPE revenue_type AS ENUM (
      'project', 'maintenance'
    );
  END IF;
END $$;

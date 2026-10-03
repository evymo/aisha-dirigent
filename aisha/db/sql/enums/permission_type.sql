-- Enum: permission_type

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'permission_type') THEN
    CREATE TYPE permission_type AS ENUM (
      'read',
  'write'
    );
  END IF;
END $$;

-- Values: read, write

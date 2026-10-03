-- Enum: journal_severity

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journal_severity') THEN
    CREATE TYPE journal_severity AS ENUM (
      'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical'
    );
  END IF;
END $$;

-- Values: debug, info, notice, warning, error, critical

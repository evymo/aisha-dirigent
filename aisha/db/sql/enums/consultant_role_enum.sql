-- Enum: consultant_role_enum

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consultant_role_enum') THEN
    CREATE TYPE consultant_role_enum AS ENUM (
      'consultant',
      'supervisor',
      'account_manager',
      'communication',
      'secretary'
    );
  END IF;
END $$;

-- Values: consultant, supervisor, account_manager, communication, secretary
-- account_manager/communication/secretary added by migration
-- 20260523100000_audience_minimal_schema (ALTER TYPE ... ADD VALUE IF NOT EXISTS).

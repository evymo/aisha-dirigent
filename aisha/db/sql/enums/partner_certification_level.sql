-- Enum: partner_certification_level

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'partner_certification_level') THEN
    CREATE TYPE partner_certification_level AS ENUM (
      'certified_partner',
  'certified_provider'
    );
  END IF;
END $$;

-- Values: certified_partner, certified_provider

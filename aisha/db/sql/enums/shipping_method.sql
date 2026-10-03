-- Enum: shipping_method

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shipping_method') THEN
    CREATE TYPE shipping_method AS ENUM (
      'packeta_pickup',
  'packeta_home',
  'personal_pickup',
  'other'
    );
  END IF;
END $$;

-- Values: packeta_pickup, packeta_home, personal_pickup, other

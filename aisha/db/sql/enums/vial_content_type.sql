-- Enum: vial_content_type

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vial_content_type') THEN
    CREATE TYPE vial_content_type AS ENUM (
      'active',
  'placebo',
  'comparator'
    );
  END IF;
END $$;

-- Values: active, placebo, comparator

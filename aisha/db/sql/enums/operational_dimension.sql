-- Enum: operational_dimension

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operational_dimension') THEN
    CREATE TYPE operational_dimension AS ENUM (
      'VIT',
  'ENE',
  'SLP',
  'PHY',
  'MET',
  'IMM',
  'PSY',
  'COG',
  'MOO'
    );
  END IF;
END $$;

-- Values: VIT, ENE, SLP, PHY, MET, IMM, PSY, COG, MOO

-- Enum: contribution_type_enum

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contribution_type_enum') THEN
    CREATE TYPE contribution_type_enum AS ENUM (
      'financial',
  'tokens_governance',
  'tokens_impact'
    );
  END IF;
END $$;

-- Values: financial, tokens_governance, tokens_impact

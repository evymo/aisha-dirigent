-- Enum: expert_rule_status

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expert_rule_status') THEN
    CREATE TYPE expert_rule_status AS ENUM (
      'draft',
  'review',
  'published',
  'archived'
    );
  END IF;
END $$;

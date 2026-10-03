-- Enum: rule_binding_target_type

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rule_binding_target_type') THEN
    CREATE TYPE rule_binding_target_type AS ENUM (
      'agent',
  'story',
  'plan',
  'global'
    );
  END IF;
END $$;

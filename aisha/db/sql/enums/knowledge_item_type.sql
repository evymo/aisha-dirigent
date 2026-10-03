-- Enum: knowledge_item_type

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'knowledge_item_type') THEN
    CREATE TYPE knowledge_item_type AS ENUM (
      'expert_rule',
  'engineering_doc',
  'domain_doc',
  'playbook',
  'case_study',
  'personality_trait',
  'core_value'
    );
  END IF;
END $$;

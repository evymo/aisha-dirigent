-- Enum: expert_rule_category

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expert_rule_category') THEN
    CREATE TYPE expert_rule_category AS ENUM (
      'coding_standard',
  'architecture_pattern',
  'testing_strategy',
  'devops_pipeline',
  'ux_guideline',
  'api_design',
  'data_modeling',
  'security_practice',
  'performance_optimization',
  'documentation_standard',
  'project_management',
  'ai_prompt_engineering',
  'domain_knowledge',
  'integration_pattern',
  'other'
    );
  END IF;
END $$;

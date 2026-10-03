-- Enum: app_role

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE app_role AS ENUM (
      'admin',
  'staff',
  'practitioner',
  'member',
  'evaluator',
  'partner',
  'consultant',
  'production_operator',
  'production_supervisor',
  'quality_manager',
  'researcher'
    );
  END IF;
END $$;

-- Values: admin, staff, practitioner, member, evaluator, partner, consultant, production_operator, production_supervisor, quality_manager, researcher

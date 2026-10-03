-- Enum: workflow_step_status

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_step_status') THEN
    CREATE TYPE workflow_step_status AS ENUM (
      'pending',
  'in_progress',
  'completed',
  'failed',
  'skipped'
    );
  END IF;
END $$;

-- Values: pending, in_progress, completed, failed, skipped

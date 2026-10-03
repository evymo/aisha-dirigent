-- Enum: blockchain_event_type

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'blockchain_event_type') THEN
    CREATE TYPE blockchain_event_type AS ENUM (
      'batch_created',
  'batch_qc_approved',
  'batch_released',
  'study_started',
  'study_unblinded',
  'study_completed',
  'milestone_achieved',
  'token_event',
  'policy_change'
    );
  END IF;
END $$;

-- Values: batch_created, batch_qc_approved, batch_released, study_started, study_unblinded, study_completed, milestone_achieved, token_event, policy_change

-- Web Artifact Job Status Enum
-- Lifecycle: pending -> processing -> ready_for_review -> approved -> applied (terminal)
-- Terminal failures: rejected, failed
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'web_artifact_job_status') THEN
    CREATE TYPE web_artifact_job_status AS ENUM (
      'pending',
      'processing',
      'ready_for_review',
      'approved',
      'applied',
      'rejected',
      'failed'
    );
  END IF;
END $$;

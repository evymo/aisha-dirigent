-- Playwright run lifecycle.
-- Created when a run is requested, transitions to running once the container starts,
-- terminal in passed / failed / errored / aborted.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'playwright_run_status') THEN
    CREATE TYPE public.playwright_run_status AS ENUM (
      'queued',
      'running',
      'passed',
      'failed',
      'errored',
      'aborted'
    );
  END IF;
END $$;

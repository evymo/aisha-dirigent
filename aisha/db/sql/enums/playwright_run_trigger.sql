-- How a Playwright run was initiated.
-- staging_auto: WF_DEPLOY_STORY auto-fires after a staging deploy
-- production_manual: operator/admin requests on-demand (audit required)
-- scheduled: cron-like (nightly regression) — optional follow-up
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'playwright_run_trigger') THEN
    CREATE TYPE public.playwright_run_trigger AS ENUM (
      'staging_auto',
      'production_manual',
      'scheduled'
    );
  END IF;
END $$;

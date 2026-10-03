-- ============================================================================
-- STEP 26b: LLM Quota daily-reset pg_cron job
-- Phase 12 WP 2.3 — LLM token rate limit per JWT.sub
--
-- WHY THIS LIVES IN SEED (not in the baseline):
--   The 'llm-quota-daily-reset' pg_cron job zeroes consumed_tokens_today /
--   consumed_cost_today at 00:00 UTC. It is a RUNTIME registration (a
--   cron.schedule() side effect), not schema DDL — the baseline generator
--   (scripts/db/generate-init-migration-from-sources.mjs) only folds in the
--   structural sql/ categories (tables/functions/grants/rls/...), never cron
--   job registration. The original WP 2.3 migration carried this block, but
--   under the 0.9.0 baseline-only policy that migration is archived
--   (archive/migrations/20260521050000_llm_quota.sql) and does NOT run on a
--   fresh `--wipe` cold-start. So the job must be (re)registered here, on the
--   cold-start apply+seed path, exactly like the tier seed in 26_llm_tier_defaults.sql.
--
-- CORRECTNESS vs OPTIMISATION:
--   The cron job is purely an optimisation. The correctness guarantee — daily
--   counters reset before they are read — is the lazy-reset inside
--   fn_check_and_consume_llm_quota_audited (resets when
--   last_reset_at < date_trunc('day', now())). The cron job only avoids the
--   first-call-of-day paying for that reset UPDATE. If pg_cron is not installed
--   (some local-dev DBs), this block is a no-op and the lazy-reset covers it.
--
-- Idempotent: the job is keyed by name. pg_cron has no "schedule if not exists",
--   so we unschedule any existing job of the same name first, then re-create.
--   Re-running this seed is safe and picks up schedule/body tweaks.
--   Keep the schedule + body in lockstep with the gate
--   (src/tests/gates/wp-2-3-llm-quota.gate.test.ts) and the archived migration.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove old schedule (if any) — pg_cron has no "schedule if not exists"
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'llm-quota-daily-reset';

    -- Re-create — 00:00 UTC daily
    PERFORM cron.schedule(
      'llm-quota-daily-reset',
      '0 0 * * *',
      $cron$
        UPDATE public.llm_quota SET
          consumed_tokens_today = 0,
          consumed_cost_today   = 0,
          last_reset_at         = date_trunc('day', now()),
          updated_at            = now()
        WHERE last_reset_at < date_trunc('day', now());
      $cron$
    );
  END IF;
  -- If pg_cron isn't installed (some local-dev DBs), the daily reset is
  -- handled by the lazy-reset logic inside fn_check_and_consume_llm_quota_audited.
  -- The cron job is purely an optimisation to avoid the lazy-reset doing
  -- a row update on every first-call-of-day.
END $$;

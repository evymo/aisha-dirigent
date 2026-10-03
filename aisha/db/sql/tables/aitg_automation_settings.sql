-- ============================================================================
-- Table: aitg_automation_settings
-- Purpose: Operator-controllable cadence + parameters for every AITG
--          automation (continuous heartbeat, daily reflection, nightly full
--          sweep, drift detection, auto-close findings, runtime sentinel,
--          PR gate, mode-of-operation defaults).
--
-- Modes:
--   - 'automated'  → workflow runs on its configured schedule
--   - 'manual'     → workflow only runs on operator/Aisha "trigger" button
--   - 'disabled'   → workflow short-circuits at the read-setting step
--
-- The settings row is the source of truth. Every WF_AITG_* workflow first
-- reads its row, exits early if disabled, honours interval/cron overrides,
-- and records last_run_at after execution. The Appsmith "AITG Automation
-- Control" page reads/writes this table through audited RPCs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.aitg_automation_settings (
  automation_id        text PRIMARY KEY
                         CHECK (automation_id ~ '^[a-z][a-z0-9_]+$'),
  display_name         text NOT NULL,
  description          text NOT NULL,
  mode                 text NOT NULL DEFAULT 'automated'
                         CHECK (mode IN ('automated', 'manual', 'disabled')),
  schedule_cron        text,
  schedule_interval_minutes int CHECK (schedule_interval_minutes IS NULL
                                       OR schedule_interval_minutes BETWEEN 1 AND 1440),
  parameters           jsonb NOT NULL DEFAULT '{}'::jsonb,
  workflow_id          text,                    -- n8n workflow id when applicable
  last_run_at          timestamptz,
  last_run_status      text CHECK (last_run_status IS NULL
                                   OR last_run_status IN ('success','failed','skipped','running')),
  last_run_details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES aisha_auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitg_automation_settings_schedule_exclusive CHECK (
    -- exactly one of cron / interval may be set when mode = automated
    NOT (mode = 'automated' AND schedule_cron IS NOT NULL AND schedule_interval_minutes IS NOT NULL)
  )
);

ALTER TABLE public.aitg_automation_settings ENABLE ROW LEVEL SECURITY;

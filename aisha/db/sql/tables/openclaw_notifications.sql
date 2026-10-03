-- Table: openclaw_notifications
-- Outbox for AISHA → OpenClaw outbound notifications.
-- AISHA INSERTs a row; n8n's WF_OPENCLAW_NOTIFY scans every 30s and dispatches
-- to the appropriate channel (Telegram/Slack/Matrix/in_app) via OpenClaw.
--
-- Mirrors the blockchain_audit_records outbox pattern.

CREATE TABLE IF NOT EXISTS public.openclaw_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Channel selection
  channel text NOT NULL CHECK (channel IN ('telegram', 'slack', 'matrix', 'discord', 'email', 'in_app')),
  recipient text,
  template text NOT NULL DEFAULT 'plain',

  -- Payload — channel-specific shape, validated by template handler in OpenClaw
  payload jsonb NOT NULL,

  -- Lifecycle
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempt_count int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  next_retry_at timestamptz,
  sent_at timestamptz,
  error text,

  -- AISHA context
  agent_slug text DEFAULT 'aisha',
  related_run_id uuid REFERENCES public.ai_runs(id),
  story_id uuid REFERENCES public.partner_stories ON DELETE SET NULL,

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.openclaw_notifications ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.openclaw_notifications IS
  'AISHA → OpenClaw outbound notification outbox. WF_OPENCLAW_NOTIFY scans + '
  'dispatches every 30s. Channels: telegram/slack/matrix/discord/email/in_app.';

-- Indexes live in aisha/db/sql/indexes/idx_openclaw_notifications.sql per
-- SQL Source Separation rule.

-- Columns added by later migrations (back-port reconciliation):
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS campaign_id uuid;
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS campaign_run_id uuid;
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS opened_at timestamp with time zone;
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS clicked_at timestamp with time zone;
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS bounced_at timestamp with time zone;
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS unsubscribed_at timestamp with time zone;

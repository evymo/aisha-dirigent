-- ============================================================================
-- Source of Truth: integration_events
-- Popis: Univerzální event store pro trackování, idempotency a retry
--        všech příchozích webhooků a integračních událostí.
--        Klíčový pro: dedup (UNIQUE constraint), retry orchestration,
--        eskalaci exhausted eventů, self-learning z metrik.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.integration_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity & source
  event_source    text NOT NULL                       -- 'github_webhook', 'forgejo_webhook', 'stripe_webhook', 'deployment', 'n8n_callback', 'email_inbound'
                  CHECK (event_source IN (
                    'github_webhook', 'forgejo_webhook', 'stripe_webhook',
                    'deployment', 'n8n_callback', 'manual', 'email_inbound'
                  )),
  external_id     text NOT NULL,                      -- X-GitHub-Delivery UUID, Stripe event ID, etc.
  event_type      text NOT NULL,                      -- 'pull_request.opened', 'push', 'installation.created', 'deploy_ssh_shell'

  -- Context resolution
  installation_id bigint,                             -- FK github_app_installations (NULL for non-GitHub)
  story_id        uuid REFERENCES public.partner_stories ON DELETE SET NULL,                               -- resolved from payload
  partner_id      uuid REFERENCES public.partner_profiles ON DELETE SET NULL,                               -- resolved from installation/story

  -- Processing lifecycle
  status          text NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received', 'processing', 'completed', 'failed', 'exhausted', 'skipped_duplicate')),
  processing_started_at  timestamptz,
  processing_finished_at timestamptz,
  duration_ms     integer GENERATED ALWAYS AS (
                    CASE WHEN processing_started_at IS NOT NULL AND processing_finished_at IS NOT NULL
                         THEN EXTRACT(EPOCH FROM (processing_finished_at - processing_started_at))::integer * 1000
                         ELSE NULL
                    END
                  ) STORED,

  -- Retry
  attempt         integer NOT NULL DEFAULT 1,
  max_attempts    integer NOT NULL DEFAULT 3,
  next_retry_at   timestamptz,                        -- calculated exponential backoff

  -- Routing & correlation
  routed_to       text,                               -- n8n webhook path or edge function
  n8n_execution_id text,                              -- for trace correlation with n8n
  payload_hash    text,                               -- SHA-256 of payload (optional dedup helper)

  -- Error tracking
  error_json      jsonb,                              -- { message, code, stack_hint }

  -- Timestamps
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Idempotency constraint
  UNIQUE (event_source, external_id)
);

-- Comments
COMMENT ON TABLE public.integration_events IS 'Univerzální event store – idempotency, retry, observability';
COMMENT ON COLUMN public.integration_events.external_id IS 'X-GitHub-Delivery, Stripe event ID – klíč pro dedup';
COMMENT ON COLUMN public.integration_events.duration_ms IS 'Automaticky počítáno z processing timestamps (ms)';
COMMENT ON COLUMN public.integration_events.next_retry_at IS 'Exponenciální backoff: attempt 1→1min, 2→5min, 3→15min';

ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;

-- Columns added by later migrations (back-port reconciliation):
ALTER TABLE public.integration_events ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

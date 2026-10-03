-- Table: rollback_history
-- Sledování všech rollback request-ů — pending → approved → executed lifecycle.
-- Triggered přes WF_SENTRY_OBSERVER (auto), manual UI button, nebo drift remediation.
-- Source: docs/deploy/SENTRY_OBSERVER.md §2.4

CREATE TABLE IF NOT EXISTS public.rollback_history (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name            text         NOT NULL,
  triggered_at        timestamptz  NOT NULL DEFAULT now(),
  triggered_by        text         NOT NULL CHECK (triggered_by IN (
                        'sentry_observer', 'manual', 'approval_gate', 'drift_remediation'
                      )),
  from_slot           text         NOT NULL CHECK (from_slot IN ('blue', 'green')),
  to_slot             text         NOT NULL CHECK (to_slot IN ('blue', 'green')),
  from_image_tag      text,
  to_image_tag        text,
  sentry_correlation  jsonb,                          -- snapshot of correlate_sentry_with_deploys output
  approval_id         uuid,                           -- FK to integration_service_logs (approval request log)
  approval_status     text         NOT NULL DEFAULT 'pending'
                      CHECK (approval_status IN (
                        'pending', 'approved', 'rejected', 'expired', 'executed', 'failed', 'aborted'
                      )),
  approved_by         uuid,
  approved_at         timestamptz,
  executed_at         timestamptz,
  execution_status    text         CHECK (execution_status IN ('success', 'failed', 'partial')),
  execution_details   jsonb,
  metadata            jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT chk_distinct_slots CHECK (from_slot <> to_slot)
);

COMMENT ON TABLE public.rollback_history IS
  'Sledování všech rollback request-ů — pending → approved → executed lifecycle.  Triggered přes WF_SENTRY_OBSERVER (auto), manual UI button, nebo drift remediation.';

ALTER TABLE public.rollback_history ENABLE ROW LEVEL SECURITY;

-- Table: drift_state
-- Snapshot drift detekcí mezi desired (manifest) a actual (Coolify API) stavem aplikací.
-- Spravováno WF_DRIFT_OBSERVER (n8n cron 10min) přes record_drift_observation RPC.
-- Source: docs/deploy/DRIFT_OBSERVER.md (Phase 1 of AUTONOMOUS_DEPLOY_FLOW.md)

CREATE TABLE IF NOT EXISTS public.drift_state (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  observed_at     timestamptz  NOT NULL DEFAULT now(),
  app_uuid        text         NOT NULL,
  app_name        text         NOT NULL,
  drift_kind      text         NOT NULL CHECK (drift_kind IN (
                    'env_var_value', 'env_var_missing', 'env_var_extra',
                    'secret_drift', 'image_tag', 'replicas',
                    'traefik_labels', 'missing_app', 'extra_app', 'domain_mismatch'
                  )),
  desired_value   jsonb,
  actual_value    jsonb,
  risk_level      text         NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
  remediation     text         NOT NULL DEFAULT 'pending'
                  CHECK (remediation IN (
                    'pending', 'auto', 'approved', 'manual', 'ignored', 'approval_pending'
                  )),
  approval_id     uuid,
  resolved_at     timestamptz,
  resolved_by     uuid,
  resolution_note text,
  observation_count int         NOT NULL DEFAULT 1,
  metadata        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.drift_state IS
  'Snapshot drift detekcí mezi desired (manifest) a actual (Coolify API) stavem aplikací. Spravováno WF_DRIFT_OBSERVER.';
COMMENT ON COLUMN public.drift_state.observation_count IS
  'Počet pozorování stejného driftu v 5min bucket-u (deduplikace přes record_drift_observation).';
COMMENT ON COLUMN public.drift_state.risk_level IS
  'Computed via fn_evaluate_proposal_risk(category=infrastructure_drift) at observe time.';
COMMENT ON COLUMN public.drift_state.remediation IS
  'pending=just observed, auto=auto-fixed, approval_pending=waiting on WF_APPROVAL_GATE,  approved=fix executed after approval, manual=admin will fix, ignored=allowlisted.';

ALTER TABLE public.drift_state ENABLE ROW LEVEL SECURITY;

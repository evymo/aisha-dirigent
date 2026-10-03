-- Table: audit_journal
-- Source of truth pro audit log
-- RLS: ENABLED
--
-- Rozšířeno pro podporu zálohy z 23.12.2025:
-- - action_type slouží jako primární akce (action je nullable fallback)
-- - ip_address, user_agent, session_id, request_id pro tracking
-- - blockchain_recorded_at, requires_blockchain_record pro blockchain audit

CREATE TABLE IF NOT EXISTS audit_journal (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  user_email text,
  -- action_type je primární pole pro typ akce (create, update, delete, view, etc.)
  action_type text,
  -- action je povinné pole pro audit trail (trigger zajistí fallback z action_type)
  action text NOT NULL DEFAULT 'unknown',
  entity_type text,
  entity_id text,
  area text,
  severity text DEFAULT 'info'::text,
  summary text,
  details jsonb,
  old_values jsonb,
  new_values jsonb,
  -- Legacy fields pro zpětnou kompatibilitu
  old_data jsonb,
  new_data jsonb,
  metadata jsonb,
  -- Request tracking
  ip_address inet,
  user_agent text,
  session_id text,
  request_id text,
  -- User context
  user_role text,
  -- Blockchain audit
  blockchain_hash text,
  blockchain_tx_hash text,
  blockchain_recorded_at timestamptz,
  blockchain_status text,
  requires_blockchain_record boolean DEFAULT false,
  -- Trace correlation (added: 20260404120000_audit_trace_and_enforcement_rules)
  ai_run_id uuid,           -- FK to ai_runs.id — links audit entry to AI run
  langfuse_trace_id text,   -- Langfuse trace ID for cross-platform observability correlation
  -- Tags pro kategorii
  tags text[] DEFAULT '{}'::text[],
  -- Timestamps
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT audit_journal_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT audit_journal_ai_run_fkey FOREIGN KEY (ai_run_id) REFERENCES public.ai_runs(id) ON DELETE SET NULL
);

ALTER TABLE audit_journal ENABLE ROW LEVEL SECURITY;

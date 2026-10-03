-- Table: blockchain_audit_records
-- Transactional outbox for blockchain synchronization
-- Tracks token_transactions → Cosmos chain sync lifecycle
-- Status machine: queued → dispatched → processing → confirmed | failed | exhausted
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS blockchain_audit_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  record_type text,
  record_hash text,
  data jsonb,
  previous_hash text,
  created_at timestamptz DEFAULT now(),

  -- Queue/outbox columns
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'dispatched', 'processing', 'confirmed', 'failed', 'exhausted')),
  retry_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_retry_at timestamptz,
  processing_started_at timestamptz,
  updated_at timestamptz DEFAULT now(),
  cosmos_tx_hash text,
  error_message text,
  correlation_id uuid DEFAULT gen_random_uuid(),

  -- Foreign key to source transaction
  token_transaction_id uuid REFERENCES token_transactions(id),

  -- Idempotency columns (reference to source entity)
  reference_table text,
  reference_id uuid,

  -- OPANCHOR (operational-anchor coverage): record_type is a CLOSED taxonomy (not
  -- free text). The allowed set is a SUPERSET of the existing token/cognition/audit
  -- types PLUS the Tier-1 consequential-event categories the committed producers
  -- emit — deploy / blue-green, PKI rotation, governance ballots,
  -- improvement_proposals (agent-change approvals) and privileged-admin / security.
  -- NULL is permitted (legacy edge helper may leave it unset). Extend this list in
  -- lockstep with any new anchor producer.
  CONSTRAINT blockchain_audit_records_record_type_check CHECK (
    record_type IS NULL OR record_type IN (
      -- token movements
      'token_sync', 'token_award', 'token_transfer', 'token_burn', 'token_mint',
      -- governance ballots + proposals (governance_votes anchoring)
      'governance_vote', 'governance_proposal',
      -- consent lifecycle
      'consent_grant', 'consent_revoke',
      -- AI cognition decisions
      'aisha_cognition_anchor',
      -- deploys / blue-green
      'blue_green_switch', 'blue_green', 'deploy', 'deployment',
      -- PKI cert rotation
      'pki_rotation', 'cert_rotation',
      -- other committed operational producers
      'compliance_check', 'dirigent_action', 'escalation', 'ragnarok_agent_run',
      -- agent-change approvals (improvement_proposals)
      'improvement_proposal', 'agent_change_approval',
      -- privileged admin actions + security events
      'admin_privileged', 'admin_action', 'security_event'
    )
  ),

  PRIMARY KEY (id)
);

ALTER TABLE blockchain_audit_records ENABLE ROW LEVEL SECURITY;

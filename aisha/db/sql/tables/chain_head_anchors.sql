-- Table: chain_head_anchors
-- Path-2 external tamper-evidence ledger — one row per on-chain attestation of
-- the blockchain_audit_records hash-chain head (head_hash from
-- fn_verify_audit_chain), committed to the Cosmos ledger.
--
-- WHY: the in-DB hash chain (record_hash/previous_hash) is only self-referential —
--   a superuser or a restore-from-backup that silently drops rows can rewrite
--   history and re-run the heals backfill so fn_verify_audit_chain still returns
--   ok=true. Periodically publishing the head hash to an append-only external
--   ledger (Cosmos) makes a later divergence between the DB head and the last
--   anchored head provable. Each row records the head hash that was committed and
--   the returned Cosmos tx hash (the external proof).
-- RLS: ENABLED (admin/staff or service_role read; writes only via the audited
--   record_chain_head_anchor SECURITY DEFINER RPC).

CREATE TABLE IF NOT EXISTS chain_head_anchors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),

  -- The chain head hash (fn_verify_audit_chain head_hash) that was committed.
  head_hash text NOT NULL,
  -- How many chain links the head covered at attestation time (verifier rows_verified).
  rows_verified bigint,

  -- External proof: the Cosmos tx hash carrying the head_hash in its memo.
  cosmos_tx_hash text,
  -- Attestation outcome — 'confirmed' once broadcast succeeds, 'failed' otherwise.
  status text NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'failed')),
  error_message text,

  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id)
);

ALTER TABLE chain_head_anchors ENABLE ROW LEVEL SECURITY;

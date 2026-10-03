-- Table: ledger_participation
-- Per-member opt-out surface for PERSONAL on-chain / Cosmos anchoring (LOCKED
-- DECISION D2). This governs ONLY layer 2 (pushing a member's activity to the
-- Cosmos chain + binding it to their personal wallet). Layer 1 — the in-DB
-- hash-chain book (blockchain_audit_records + its chain-link/guard triggers) — is
-- ALWAYS ON and is NEVER gated by this flag.
--
-- Default: participates = true (opt-out model). Absence of a row is treated as
-- participating by the readers (fn_queue_blockchain_sync). A member records their
-- choice via update_my_ledger_participation; the choice is PRESERVED across any
-- migration/heal re-apply (seed writers use ON CONFLICT DO NOTHING — mirroring the
-- provider-catalog is_enabled precedent).
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS public.ledger_participation (
  user_id uuid NOT NULL,
  participates boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id),
  CONSTRAINT ledger_participation_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.ledger_participation ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ledger_participation IS
  'Per-member opt-out for personal on-chain anchoring (D2). Gates layer 2 (Cosmos '
  'dispatch) only; the in-DB hash-chain book stays unconditional. Default participates=true.';

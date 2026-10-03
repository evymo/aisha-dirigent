-- Table: governance_proposals
-- Local governance ballot ledger (LOCKED DECISION D3): member voting is recorded
-- in a LOCAL, queryable proposal + ballot store — not only broadcast by a single
-- custodial backend signer. A proposal carries its lifecycle, quorum and a running
-- tally derived from governance_votes.
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS public.governance_proposals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  proposal_type text NOT NULL DEFAULT 'general',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'passed', 'rejected', 'executed', 'cancelled')),
  quorum numeric(20,8) NOT NULL DEFAULT 0,
  tally jsonb NOT NULL DEFAULT jsonb_build_object('for', 0, 'against', 0, 'abstain', 0, 'voter_count', 0),
  created_by uuid,
  opens_at timestamptz,
  closes_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT governance_proposals_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.governance_proposals ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.governance_proposals IS
  'Local governance proposal ledger (D3): lifecycle + quorum + weight-derived tally.';

-- Table: governance_votes
-- Local member ballots (LOCKED DECISION D3). One ballot per member per proposal;
-- vote weight is DERIVED server-side from governance token holdings (never a
-- client-supplied number). Every ballot is bound to the immutable hash chain by
-- cast_governance_vote (a blockchain_audit_records row keyed on
-- reference_table='governance_votes').
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS public.governance_votes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL,
  user_id uuid NOT NULL,
  choice text NOT NULL
    CHECK (choice IN ('for', 'against', 'abstain')),
  weight numeric(20,8) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT governance_votes_proposal_user_key UNIQUE (proposal_id, user_id),
  CONSTRAINT governance_votes_proposal_id_fkey
    FOREIGN KEY (proposal_id) REFERENCES public.governance_proposals(id) ON DELETE CASCADE,
  CONSTRAINT governance_votes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.governance_votes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.governance_votes IS
  'Local member ballots (D3): one per member per proposal, server-derived weight, '
  'each anchored into blockchain_audit_records via cast_governance_vote.';

-- Index: idx_aisha_tooling_proposals_kind

CREATE INDEX IF NOT EXISTS idx_aisha_tooling_proposals_kind
  ON public.aisha_tooling_proposals (proposal_kind, proposed_at DESC);

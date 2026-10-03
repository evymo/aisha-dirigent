-- Index: idx_aisha_tooling_proposals_pending

CREATE INDEX IF NOT EXISTS idx_aisha_tooling_proposals_pending
  ON public.aisha_tooling_proposals (approval_status, proposed_at DESC)
  WHERE approval_status = 'pending';

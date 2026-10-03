-- Index: idx_aisha_tooling_proposals_bundle

CREATE INDEX IF NOT EXISTS idx_aisha_tooling_proposals_bundle
  ON public.aisha_tooling_proposals (proposal_bundle_id)
  WHERE proposal_bundle_id IS NOT NULL;

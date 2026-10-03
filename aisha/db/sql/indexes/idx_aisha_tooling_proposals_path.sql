-- Index: idx_aisha_tooling_proposals_path

CREATE INDEX IF NOT EXISTS idx_aisha_tooling_proposals_path
  ON public.aisha_tooling_proposals (artifact_path);

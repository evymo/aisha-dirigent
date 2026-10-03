-- Index: idx_invitations_study_id
-- Table: invitations

CREATE INDEX IF NOT EXISTS idx_invitations_study_id ON public.invitations(study_id);

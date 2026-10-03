-- Index: idx_invitations_created_by
-- Table: invitations

CREATE INDEX IF NOT EXISTS idx_invitations_created_by ON public.invitations(created_by);

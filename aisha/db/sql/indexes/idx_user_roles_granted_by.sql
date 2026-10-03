-- Index: idx_user_roles_granted_by
-- Table: user_roles

CREATE INDEX IF NOT EXISTS idx_user_roles_granted_by ON public.user_roles(granted_by);

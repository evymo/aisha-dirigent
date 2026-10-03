-- Index: idx_roles_updated_by
-- Table: roles

CREATE INDEX IF NOT EXISTS idx_roles_updated_by ON public.roles(updated_by);

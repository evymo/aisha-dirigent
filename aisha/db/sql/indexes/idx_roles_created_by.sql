-- Index: idx_roles_created_by
-- Table: roles

CREATE INDEX IF NOT EXISTS idx_roles_created_by ON public.roles(created_by);

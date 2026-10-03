-- Index: idx_role_permissions_granted_by
-- Table: role_permissions

CREATE INDEX IF NOT EXISTS idx_role_permissions_granted_by ON public.role_permissions(granted_by);

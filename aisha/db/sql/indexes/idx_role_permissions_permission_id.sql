-- Index: idx_role_permissions_permission_id
-- Table: role_permissions

CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON public.role_permissions(permission_id);

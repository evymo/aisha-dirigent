-- Index: idx_app_role_permissions_granted_by
-- Table: app_role_permissions

CREATE INDEX IF NOT EXISTS idx_app_role_permissions_granted_by ON public.app_role_permissions(granted_by);

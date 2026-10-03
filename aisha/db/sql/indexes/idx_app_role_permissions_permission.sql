-- Index: idx_app_role_permissions_permission
-- Table: app_role_permissions

CREATE INDEX idx_app_role_permissions_permission ON public.app_role_permissions USING btree (permission_id);

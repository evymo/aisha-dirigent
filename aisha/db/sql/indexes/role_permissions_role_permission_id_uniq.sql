-- Index: role_permissions_role_permission_id_uniq
-- Table: role_permissions

CREATE UNIQUE INDEX role_permissions_role_permission_id_uniq ON public.role_permissions USING btree (role, permission_id) WHERE (permission_id IS NOT NULL);

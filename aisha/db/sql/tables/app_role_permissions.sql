-- Table: app_role_permissions
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS app_role_permissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  role app_role NOT NULL,
  permission_id uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT app_role_permissions_role_permission_id_key UNIQUE (role, permission_id),
  CONSTRAINT app_role_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT app_role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

ALTER TABLE app_role_permissions ENABLE ROW LEVEL SECURITY;

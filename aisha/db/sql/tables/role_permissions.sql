-- Table: role_permissions
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS role_permissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  role app_role NOT NULL,
  section admin_section NOT NULL,
  permission permission_type NOT NULL,
  granted_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  permission_id uuid,
  PRIMARY KEY (id),
  CONSTRAINT role_permissions_role_section_permission_key UNIQUE (section, permission, role),
  CONSTRAINT role_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES permissions(id)
);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

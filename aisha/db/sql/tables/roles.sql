-- Table: roles
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name app_role NOT NULL,
  display_name text NOT NULL,
  description text,
  is_admin bool NOT NULL DEFAULT false,
  is_system bool NOT NULL DEFAULT false,
  can_manage_users bool NOT NULL DEFAULT false,
  can_manage_roles bool NOT NULL DEFAULT false,
  can_view_phi bool NOT NULL DEFAULT false,
  can_export_phi bool NOT NULL DEFAULT false,
  can_break_glass bool NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT roles_name_key UNIQUE (name),
  CONSTRAINT roles_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT roles_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

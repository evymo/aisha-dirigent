-- Table: role_definitions
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS role_definitions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  role_name text NOT NULL,
  display_name text,
  description text,
  is_system bool DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  is_admin bool NOT NULL DEFAULT false,
  can_manage_users bool NOT NULL DEFAULT false,
  can_manage_roles bool NOT NULL DEFAULT false,
  can_view_phi bool NOT NULL DEFAULT false,
  can_export_phi bool NOT NULL DEFAULT false,
  can_break_glass bool NOT NULL DEFAULT false,
  PRIMARY KEY (id),
  CONSTRAINT role_definitions_role_name_key UNIQUE (role_name)
);

ALTER TABLE role_definitions ENABLE ROW LEVEL SECURITY;

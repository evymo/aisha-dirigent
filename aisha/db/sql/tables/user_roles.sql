-- Table: user_roles
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS user_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role app_role NOT NULL,
  role_id uuid REFERENCES public.roles ON DELETE SET NULL,
  granted_by uuid,
  granted_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role),
  CONSTRAINT user_roles_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Grants: role management (admin only writes via RPC)
GRANT SELECT ON user_roles TO authenticated;
GRANT ALL ON user_roles TO service_role;

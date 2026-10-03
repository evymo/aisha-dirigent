-- Table: instance_auth_tokens
-- Hashed auth tokens with scopes + expiry for instance-level sync authorization

CREATE TABLE IF NOT EXISTS public.instance_auth_tokens (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  instance_id uuid NOT NULL,
  token_hash text NOT NULL,
  token_name text NOT NULL DEFAULT 'default',
  scopes jsonb NOT NULL DEFAULT '["sync:import"]'::jsonb,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT instance_auth_tokens_instance_fkey
    FOREIGN KEY (instance_id) REFERENCES story_instances(id) ON DELETE CASCADE
);

ALTER TABLE public.instance_auth_tokens ENABLE ROW LEVEL SECURITY;

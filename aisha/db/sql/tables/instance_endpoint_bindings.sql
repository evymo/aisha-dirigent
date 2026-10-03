-- Table: instance_endpoint_bindings
-- Maps logical endpoint roles to instance-specific URLs and auth refs

CREATE TABLE IF NOT EXISTS public.instance_endpoint_bindings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  instance_id uuid NOT NULL,
  endpoint_role text NOT NULL,
  endpoint_url text NOT NULL,
  auth_method text DEFAULT 'bearer',
  auth_secret_ref text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT instance_endpoint_bindings_instance_fkey
    FOREIGN KEY (instance_id) REFERENCES story_instances(id) ON DELETE CASCADE,
  CONSTRAINT instance_endpoint_bindings_unique_role
    UNIQUE (instance_id, endpoint_role)
);

ALTER TABLE public.instance_endpoint_bindings ENABLE ROW LEVEL SECURITY;

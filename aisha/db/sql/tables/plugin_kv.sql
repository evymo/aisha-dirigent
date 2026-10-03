-- Table: plugin_kv

CREATE TABLE IF NOT EXISTS public.plugin_kv (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  plugin_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  value jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT plugin_kv_plugin_id_tenant_id_key_key UNIQUE (plugin_id, tenant_id, key),
  CONSTRAINT plugin_kv_plugin_id_fkey FOREIGN KEY (plugin_id) REFERENCES public.plugin_catalog(id) ON DELETE CASCADE
);

ALTER TABLE public.plugin_kv ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.plugin_kv IS 'Sandboxed key-value storage for plugins. Isolated per plugin + tenant.';

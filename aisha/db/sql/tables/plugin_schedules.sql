-- Table: plugin_schedules

CREATE TABLE IF NOT EXISTS public.plugin_schedules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  plugin_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  cron_expr text NOT NULL,
  handler_capability text NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  last_run_at timestamp with time zone,
  next_run_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT plugin_schedules_plugin_id_tenant_id_handler_capability_key UNIQUE (plugin_id, tenant_id, handler_capability),
  CONSTRAINT plugin_schedules_plugin_id_fkey FOREIGN KEY (plugin_id) REFERENCES public.plugin_catalog(id) ON DELETE CASCADE
);

ALTER TABLE public.plugin_schedules ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.plugin_schedules IS 'Cron-scheduled tasks registered by plugins via SandboxContext.schedule().';

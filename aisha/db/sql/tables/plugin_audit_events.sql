-- Table: plugin_audit_events

CREATE TABLE IF NOT EXISTS public.plugin_audit_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  plugin_id uuid NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT plugin_audit_events_plugin_id_fkey FOREIGN KEY (plugin_id) REFERENCES public.plugin_catalog(id) ON DELETE CASCADE
);

ALTER TABLE public.plugin_audit_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.plugin_audit_events IS 'Audit trail for all plugin lifecycle operations.';

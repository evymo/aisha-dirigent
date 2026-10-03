-- Table: plugin_health_events

CREATE TABLE IF NOT EXISTS public.plugin_health_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  plugin_id uuid NOT NULL,
  tenant_id uuid,
  event_kind public.plugin_health_event_kind NOT NULL,
  latency_ms integer,
  error_text text,
  metadata jsonb DEFAULT '{}'::jsonb,
  recorded_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT plugin_health_events_plugin_id_fkey FOREIGN KEY (plugin_id) REFERENCES public.plugin_catalog(id) ON DELETE CASCADE
);

ALTER TABLE public.plugin_health_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.plugin_health_events IS 'Health telemetry events for plugin monitoring and autopatch.';

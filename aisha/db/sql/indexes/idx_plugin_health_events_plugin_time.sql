-- Index: idx_plugin_health_events_plugin_time

CREATE INDEX IF NOT EXISTS idx_plugin_health_events_plugin_time ON public.plugin_health_events USING btree (plugin_id, recorded_at DESC);

-- Index: idx_plugin_audit_events_plugin_time

CREATE INDEX IF NOT EXISTS idx_plugin_audit_events_plugin_time ON public.plugin_audit_events USING btree (plugin_id, created_at DESC);

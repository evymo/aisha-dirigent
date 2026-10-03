-- Index: idx_plugin_schedules_next_run

CREATE INDEX IF NOT EXISTS idx_plugin_schedules_next_run ON public.plugin_schedules USING btree (next_run_at) WHERE (enabled = true);
